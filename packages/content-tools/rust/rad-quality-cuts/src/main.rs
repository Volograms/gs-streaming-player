use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};
use std::env;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use spark_lib::decoder::{ChunkReceiver, MultiDecoder, SplatFileType};
use spark_lib::gsplat::GsplatArray;
use spark_lib::spz::SpzEncoder;
use spark_lib::tsplat::{Tsplat, TsplatArray, TsplatMut};

const DEFAULT_TIERS: &str = "preview=0.10,minimum=0.25,medium=0.50,full=1.00";
const DEFAULT_INDEX_FILENAME: &str = "quality-cuts.json";
const READ_CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, PartialEq)]
struct Tier {
    id: String,
    ratio: f64,
}

#[derive(Debug)]
struct Options {
    force: bool,
    index_filename: String,
    input_paths: Vec<PathBuf>,
    max_sh: Option<usize>,
    minimum_playable: Option<String>,
    output_dir: PathBuf,
    tiers: Vec<Tier>,
}

#[derive(Clone, Copy, Debug)]
struct Candidate {
    feature_size: f32,
    index: usize,
}

impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.feature_size.to_bits() == other.feature_size.to_bits() && self.index == other.index
    }
}

impl Eq for Candidate {}

impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        self.feature_size
            .total_cmp(&other.feature_size)
            .then_with(|| other.index.cmp(&self.index))
    }
}

#[derive(Debug)]
struct TreeInfo {
    leaf_count: usize,
    root_index: usize,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let options = parse_options(env::args().skip(1))?;
    fs::create_dir_all(&options.output_dir).with_context(|| {
        format!(
            "could not create output directory {}",
            options.output_dir.display()
        )
    })?;

    let minimum_playable = resolve_minimum_playable(&options)?;
    let index_path = options.output_dir.join(&options.index_filename);
    ensure_writable_output(&index_path, options.force)?;

    let mut frame_entries = Vec::with_capacity(options.input_paths.len());
    let mut output_names = HashSet::new();
    let started = Instant::now();

    for input_path in &options.input_paths {
        frame_entries.push(process_rad(
            input_path,
            &options,
            minimum_playable.as_deref(),
            &mut output_names,
        )?);
    }

    let index = json!({
        "version": 1,
        "format": "flat-spz-quality-cuts",
        "cutStrategy": "largest-feature-frontier-v1",
        "minimumPlayableTier": minimum_playable,
        "frames": frame_entries,
    });
    write_json(&index_path, &index)?;

    println!(
        "Wrote {} frame cut set(s) and {} in {:.2}s",
        options.input_paths.len(),
        index_path.display(),
        started.elapsed().as_secs_f64()
    );
    Ok(())
}

fn process_rad(
    input_path: &Path,
    options: &Options,
    minimum_playable: Option<&str>,
    output_names: &mut HashSet<String>,
) -> Result<Value> {
    let source_bytes = fs::metadata(input_path)
        .with_context(|| format!("could not stat {}", input_path.display()))?
        .len();
    let decode_started = Instant::now();
    let mut splats = decode_rad(input_path)?;
    let decode_ms = decode_started.elapsed().as_secs_f64() * 1000.0;
    let tree = analyse_tree(&splats)?;
    let source_node_count = splats.len();
    let source_max_sh = splats.max_sh_degree();
    let max_sh = options.max_sh.unwrap_or(source_max_sh).min(source_max_sh);
    let base_name = output_base_name(input_path)?;

    println!(
        "{}: decoded {} nodes ({} leaves, SH{}) in {:.1}ms",
        input_path.display(),
        source_node_count,
        tree.leaf_count,
        source_max_sh,
        decode_ms
    );

    let mut quality_levels = Vec::with_capacity(options.tiers.len());
    for (level, tier) in options.tiers.iter().enumerate() {
        let target_splat_count =
            ((tree.leaf_count as f64 * tier.ratio).ceil() as usize).clamp(1, tree.leaf_count);
        let cut_started = Instant::now();
        let selected = select_frontier(&splats, tree.root_index, target_splat_count)?;
        let actual_ratio = selected.len() as f64 / tree.leaf_count as f64;
        let mut cut = splats.new_from_index_map(&selected);
        flatten_lod_opacity(&mut cut);
        cut.clear_children();

        let output_filename = format!("{base_name}-{}.spz", tier.id);
        if !output_names.insert(output_filename.clone()) {
            bail!("multiple inputs would write the same output file: {output_filename}");
        }
        let output_path = options.output_dir.join(&output_filename);
        ensure_writable_output(&output_path, options.force)?;

        let encoded = SpzEncoder::new(cut)
            .with_max_sh(max_sh)
            .encode()
            .with_context(|| format!("could not encode tier '{}'", tier.id))?;
        fs::write(&output_path, &encoded)
            .with_context(|| format!("could not write {}", output_path.display()))?;
        let elapsed_ms = cut_started.elapsed().as_secs_f64() * 1000.0;

        println!(
            "  {}: {} splats ({:.1}%), {} bytes in {:.1}ms",
            tier.id,
            selected.len(),
            actual_ratio * 100.0,
            encoded.len(),
            elapsed_ms
        );

        quality_levels.push(json!({
            "level": level,
            "url": output_filename,
            "detailLevel": actual_ratio,
            "byteSize": encoded.len(),
            "splatCount": selected.len(),
            "minimumPlayable": minimum_playable == Some(tier.id.as_str()),
            "metadata": {
                "tier": tier.id,
                "targetLeafRatio": tier.ratio,
                "actualLeafRatio": actual_ratio,
                "targetSplatCount": target_splat_count,
                "format": "spz",
                "flat": true,
                "maxShDegree": max_sh,
            },
        }));
    }

    Ok(json!({
        "sourceFile": input_path.file_name().and_then(|value| value.to_str()).unwrap_or_default(),
        "sourceByteSize": source_bytes,
        "sourceNodeCount": source_node_count,
        "sourceLeafCount": tree.leaf_count,
        "sourceMaxShDegree": source_max_sh,
        "rootIndex": tree.root_index,
        "decodeMilliseconds": decode_ms,
        "qualityLevels": quality_levels,
    }))
}

fn decode_rad(path: &Path) -> Result<GsplatArray> {
    let pathname = path.to_string_lossy();
    let mut decoder = MultiDecoder::new(
        GsplatArray::new(),
        Some(SplatFileType::RAD),
        Some(pathname.as_ref()),
    );
    let mut reader = BufReader::new(
        File::open(path).with_context(|| format!("could not open {}", path.display()))?,
    );
    let mut buffer = vec![0_u8; READ_CHUNK_BYTES];

    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .with_context(|| format!("could not read {}", path.display()))?;
        if bytes_read == 0 {
            break;
        }
        decoder
            .push(&buffer[..bytes_read])
            .with_context(|| format!("could not decode {}", path.display()))?;
    }
    decoder
        .finish()
        .with_context(|| format!("could not finish decoding {}", path.display()))?;
    Ok(decoder.into_splats())
}

fn analyse_tree(splats: &GsplatArray) -> Result<TreeInfo> {
    if !splats.has_children() {
        bail!("input RAD does not contain an LoD tree");
    }

    let mut parent_count = vec![0_u8; splats.len()];
    for parent in 0..splats.len() {
        for child in splats.get_children(parent) {
            if child >= splats.len() {
                bail!("node {parent} references out-of-range child {child}");
            }
            parent_count[child] = parent_count[child]
                .checked_add(1)
                .ok_or_else(|| anyhow!("node {child} has too many parents"))?;
            if parent_count[child] > 1 {
                bail!("node {child} has multiple parents");
            }
        }
    }

    let roots: Vec<_> = parent_count
        .iter()
        .enumerate()
        .filter_map(|(index, &count)| (count == 0).then_some(index))
        .collect();
    if roots.len() != 1 {
        bail!("expected one LoD root, found {}", roots.len());
    }
    let root_index = roots[0];

    let mut visited = vec![false; splats.len()];
    let mut stack = vec![root_index];
    let mut leaf_count = 0;
    while let Some(index) = stack.pop() {
        if visited[index] {
            bail!("LoD tree contains a cycle at node {index}");
        }
        visited[index] = true;
        let children = splats.get_children(index);
        if children.is_empty() {
            leaf_count += 1;
        } else {
            stack.extend(children);
        }
    }
    let reachable_count = visited.iter().filter(|&&value| value).count();
    if reachable_count != splats.len() {
        bail!(
            "LoD tree contains {} unreachable node(s)",
            splats.len() - reachable_count
        );
    }

    Ok(TreeInfo {
        leaf_count,
        root_index,
    })
}

fn select_frontier(
    splats: &GsplatArray,
    root_index: usize,
    target_count: usize,
) -> Result<Vec<usize>> {
    let mut frontier = HashSet::from([root_index]);
    let mut candidates = BinaryHeap::new();
    push_candidate(splats, root_index, &mut candidates);

    while frontier.len() < target_count {
        let Some(candidate) = candidates.pop() else {
            break;
        };
        if !frontier.contains(&candidate.index) {
            continue;
        }
        let children = splats.get_children(candidate.index);
        if children.is_empty() {
            continue;
        }
        let next_count = frontier.len() - 1 + children.len();
        if next_count > target_count {
            continue;
        }

        frontier.remove(&candidate.index);
        for child in children {
            if !frontier.insert(child) {
                bail!("LoD cut attempted to select node {child} more than once");
            }
            push_candidate(splats, child, &mut candidates);
        }
    }

    let mut selected: Vec<_> = frontier.into_iter().collect();
    selected.sort_unstable();
    Ok(selected)
}

fn push_candidate(splats: &GsplatArray, index: usize, candidates: &mut BinaryHeap<Candidate>) {
    if !splats.get_children(index).is_empty() {
        candidates.push(Candidate {
            feature_size: splats.get(index).feature_size(),
            index,
        });
    }
}

fn flatten_lod_opacity(splats: &mut GsplatArray) {
    for index in 0..splats.len() {
        let mut splat = splats.get_mut(index);
        if splat.opacity() <= 1.0 {
            continue;
        }
        // Spark's LoD encoders map merged-node opacity into 1..2. This is the
        // inverse footprint-preserving conversion used by build-lod --inflate.
        let dilation = splat.opacity() * 4.0 - 3.0;
        let opacity = ((dilation * dilation - 1.0) / std::f32::consts::E).exp();
        let scale = opacity.powf(1.0 / 3.0);
        splat.set_scales(splat.scales() * scale);
        splat.set_opacity(1.0);
    }
}

fn parse_options(args: impl IntoIterator<Item = String>) -> Result<Options> {
    let mut force = false;
    let mut index_filename = DEFAULT_INDEX_FILENAME.to_string();
    let mut input_paths = Vec::new();
    let mut max_sh = None;
    let mut minimum_playable = None;
    let mut output_dir = None;
    let mut tiers = parse_tiers(DEFAULT_TIERS)?;
    let mut args = args.into_iter();

    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--force" => force = true,
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            "--index" => {
                index_filename = next_value(&mut args, "--index")?;
            }
            "--max-sh" => {
                let value = next_value(&mut args, "--max-sh")?;
                let parsed = value
                    .parse::<usize>()
                    .with_context(|| format!("invalid --max-sh value '{value}'"))?;
                if parsed > 3 {
                    bail!("--max-sh must be between 0 and 3");
                }
                max_sh = Some(parsed);
            }
            "--minimum-playable" => {
                minimum_playable = Some(next_value(&mut args, "--minimum-playable")?);
            }
            "--output-dir" => {
                output_dir = Some(PathBuf::from(next_value(&mut args, "--output-dir")?));
            }
            "--tiers" => {
                tiers = parse_tiers(&next_value(&mut args, "--tiers")?)?;
            }
            _ if argument.starts_with("--") => bail!("unknown option '{argument}'"),
            _ => input_paths.push(PathBuf::from(argument)),
        }
    }

    if input_paths.is_empty() {
        bail!("at least one input RAD file is required");
    }
    let output_dir = output_dir.ok_or_else(|| anyhow!("--output-dir is required"))?;
    if Path::new(&index_filename)
        .file_name()
        .and_then(|value| value.to_str())
        != Some(index_filename.as_str())
    {
        bail!("--index must be a filename, not a path");
    }

    Ok(Options {
        force,
        index_filename,
        input_paths,
        max_sh,
        minimum_playable,
        output_dir,
        tiers,
    })
}

fn next_value(args: &mut impl Iterator<Item = String>, option: &str) -> Result<String> {
    args.next()
        .ok_or_else(|| anyhow!("{option} requires a value"))
}

fn parse_tiers(specification: &str) -> Result<Vec<Tier>> {
    let mut tiers = Vec::new();
    let mut names = HashSet::new();
    let mut previous_ratio = 0.0;

    for part in specification.split(',') {
        let (id, ratio) = part
            .split_once('=')
            .ok_or_else(|| anyhow!("invalid tier '{part}'; expected name=ratio"))?;
        if id.is_empty()
            || !id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
        {
            bail!("invalid tier name '{id}'");
        }
        if !names.insert(id.to_string()) {
            bail!("duplicate tier name '{id}'");
        }
        let ratio = ratio
            .parse::<f64>()
            .with_context(|| format!("invalid ratio for tier '{id}'"))?;
        if !(0.0 < ratio && ratio <= 1.0) {
            bail!("tier '{id}' ratio must be greater than 0 and at most 1");
        }
        if ratio <= previous_ratio {
            bail!("tier ratios must be ordered from lowest to highest");
        }
        previous_ratio = ratio;
        tiers.push(Tier {
            id: id.to_string(),
            ratio,
        });
    }

    if tiers.is_empty() {
        bail!("at least one tier is required");
    }
    Ok(tiers)
}

fn resolve_minimum_playable(options: &Options) -> Result<Option<String>> {
    let requested = options
        .minimum_playable
        .clone()
        .or_else(|| {
            options
                .tiers
                .iter()
                .find(|tier| tier.id == "minimum")
                .map(|tier| tier.id.clone())
        })
        .or_else(|| options.tiers.first().map(|tier| tier.id.clone()));
    if let Some(id) = &requested {
        if !options.tiers.iter().any(|tier| &tier.id == id) {
            bail!("minimum-playable tier '{id}' is not present in --tiers");
        }
    }
    Ok(requested)
}

fn output_base_name(input_path: &Path) -> Result<String> {
    let stem = input_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            anyhow!(
                "input path has no valid UTF-8 filename: {}",
                input_path.display()
            )
        })?;
    Ok(stem.strip_suffix("-lod").unwrap_or(stem).to_string())
}

fn ensure_writable_output(path: &Path, force: bool) -> Result<()> {
    if path.exists() && !force {
        bail!(
            "output already exists: {} (use --force to replace it)",
            path.display()
        );
    }
    Ok(())
}

fn write_json(path: &Path, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    fs::write(path, bytes).with_context(|| format!("could not write {}", path.display()))
}

fn print_usage() {
    println!(
        "Usage:\n  rad-quality-cuts <frame.rad> [more.rad ...] --output-dir <dir> [options]\n\n\
Options:\n  --tiers <spec>             Ordered name=leaf-ratio tiers.\n\
                             Default: {DEFAULT_TIERS}\n  --minimum-playable <name>  Tier marked minimumPlayable. Default: minimum.\n\
  --max-sh <0..3>            Limit output spherical harmonics degree.\n\
  --index <filename>         Batch metadata filename. Default: {DEFAULT_INDEX_FILENAME}\n\
  --force                    Replace existing generated files.\n\
  --help                     Show this help."
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ordered_tiers() {
        assert_eq!(
            parse_tiers("base=0.25,full=1").unwrap(),
            vec![
                Tier {
                    id: "base".to_string(),
                    ratio: 0.25,
                },
                Tier {
                    id: "full".to_string(),
                    ratio: 1.0,
                },
            ]
        );
    }

    #[test]
    fn rejects_unordered_tiers() {
        assert!(parse_tiers("high=1,low=0.25").is_err());
    }
}
