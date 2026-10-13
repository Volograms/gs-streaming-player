#!/bin/sh
# Validate the bounded cache before nginx starts. Files remain in the
# read-only source tree and are fetched into tmpfs only when requested.
set -eu

source_dir=${ASSET_CACHE_SOURCE:-/srv/source}
cache_dir=${ASSET_CACHE_DEST:-/srv/cache}
cache_size_bytes=${ASSET_CACHE_SIZE_BYTES:-6442450944}
max_cache_bytes=${ASSET_CACHE_MAX_SIZE_BYTES:-5368709120}
headroom_bytes=${ASSET_CACHE_HEADROOM_BYTES:-536870912}

fail() {
    echo "RAM asset cache: $*" >&2
    exit 1
}

is_nonnegative_integer() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

is_nonnegative_integer "$cache_size_bytes" || fail "ASSET_CACHE_SIZE_BYTES must be a non-negative integer (got '$cache_size_bytes')"
is_nonnegative_integer "$max_cache_bytes" || fail "ASSET_CACHE_MAX_SIZE_BYTES must be a non-negative integer (got '$max_cache_bytes')"
is_nonnegative_integer "$headroom_bytes" || fail "ASSET_CACHE_HEADROOM_BYTES must be a non-negative integer (got '$headroom_bytes')"
[ -d "$source_dir" ] || fail "source directory does not exist: $source_dir"
[ -d "$cache_dir" ] || fail "cache directory is not mounted: $cache_dir"
[ "$max_cache_bytes" -le "$cache_size_bytes" ] || fail "cache max size (${max_cache_bytes} bytes) exceeds tmpfs size (${cache_size_bytes} bytes)"

mount_type=$(awk -v target="$cache_dir" '$2 == target { print $3; exit }' /proc/mounts)
[ "$mount_type" = tmpfs ] || fail "cache destination is not a tmpfs mount: $cache_dir"

# Check the actual mount rather than trusting only the Compose value. df uses
# 1024-byte blocks in the nginx Alpine image.
cache_capacity_kib=$(df -Pk "$cache_dir" | awk 'NR == 2 { print $2 }')
cache_available_kib=$(df -Pk "$cache_dir" | awk 'NR == 2 { print $4 }')
is_nonnegative_integer "$cache_capacity_kib" || fail "could not determine tmpfs capacity for $cache_dir"
is_nonnegative_integer "$cache_available_kib" || fail "could not determine free tmpfs capacity for $cache_dir"
cache_capacity_bytes=$((cache_capacity_kib * 1024))
cache_available_bytes=$((cache_available_kib * 1024))
[ "$cache_capacity_bytes" -ge "$cache_size_bytes" ] || fail "mounted tmpfs capacity (${cache_capacity_bytes} bytes) is below configured size (${cache_size_bytes} bytes)"
[ "$cache_available_bytes" -ge "$max_cache_bytes" ] || fail "tmpfs has ${cache_available_bytes} free bytes but cache requires ${max_cache_bytes} bytes"

# Use the minimum of the kernel estimate and the cgroup remainder so both the
# host's available memory and a container limit are respected.
available_bytes=
available_kib=$(awk '$1 == "MemAvailable:" { print $2; exit }' /proc/meminfo)
if is_nonnegative_integer "$available_kib"; then
    available_bytes=$((available_kib * 1024))
fi
cgroup_available_bytes=
if [ -r /sys/fs/cgroup/memory.max ] && [ -r /sys/fs/cgroup/memory.current ]; then
    memory_limit=$(cat /sys/fs/cgroup/memory.max)
    memory_current=$(cat /sys/fs/cgroup/memory.current)
    if is_nonnegative_integer "$memory_limit" && is_nonnegative_integer "$memory_current" && [ "$memory_limit" -ge "$memory_current" ]; then
        cgroup_available_bytes=$((memory_limit - memory_current))
    fi
fi
if [ -z "$cgroup_available_bytes" ] && [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ] && [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]; then
    memory_limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)
    memory_current=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes)
    if is_nonnegative_integer "$memory_limit" && is_nonnegative_integer "$memory_current" && [ "$memory_limit" -ge "$memory_current" ]; then
        cgroup_available_bytes=$((memory_limit - memory_current))
    fi
fi
if [ -n "$cgroup_available_bytes" ] && { [ -z "$available_bytes" ] || [ "$cgroup_available_bytes" -lt "$available_bytes" ]; }; then
    available_bytes=$cgroup_available_bytes
fi
[ -n "$available_bytes" ] || fail "could not determine available Linux memory"

required_bytes=$((cache_size_bytes + headroom_bytes))
[ "$required_bytes" -le "$available_bytes" ] || fail "tmpfs budget plus ${headroom_bytes} byte headroom needs ${required_bytes} bytes, but only ${available_bytes} bytes are available"

echo "RAM asset cache: validated ${max_cache_bytes} byte max cache in ${cache_size_bytes} byte tmpfs" >&2
exec /docker-entrypoint.sh "$@"
