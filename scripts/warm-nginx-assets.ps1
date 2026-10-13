[CmdletBinding()]
param(
    [string]$PublicDirectory,
    [string]$BaseUrl = 'http://127.0.0.1:8080/',
    [ValidateSet('preview', 'minimum', 'medium', 'full')]
    [string[]]$Tiers = @('preview', 'minimum'),
    [ValidateRange(1, 16)]
    [int]$Concurrency = 6,
    [ValidateRange(0, 1000000)]
    [int]$MaximumFrames = 0,
    [long]$MaximumCacheBytes = 5368709120
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if (!$PublicDirectory) {
    $PublicDirectory = Join-Path $repositoryRoot 'apps/6g-showcase/public'
}
$publicRoot = (Resolve-Path -LiteralPath $PublicDirectory).ProviderPath
$baseUri = [Uri]$BaseUrl
if (!$baseUri.IsAbsoluteUri -or $baseUri.Scheme -notin @('http', 'https')) {
    throw 'BaseUrl must be an absolute HTTP or HTTPS asset-server URL.'
}
if (!$BaseUrl.EndsWith('/')) {
    throw 'BaseUrl must end with a slash.'
}
if ($MaximumCacheBytes -le 0) {
    throw 'MaximumCacheBytes must be positive and match the server cache budget.'
}

$allFiles = @(Get-ChildItem -LiteralPath $publicRoot -Recurse -File)
$warmFiles = @($allFiles | Where-Object {
    $_.Extension -ne '.json' -and $_.FullName -notmatch '[\\/]dynamic[\\/]'
})
foreach ($tier in ($Tiers | Select-Object -Unique)) {
    $tierFiles = @($allFiles | Where-Object {
        $_.FullName -match '[\\/]dynamic[\\/]' -and $_.Name -like "*-$tier.sog"
    } | Sort-Object Name)
    if ($tierFiles.Count -eq 0) {
        throw "No dynamic $tier SOG files exist beneath $publicRoot."
    }
    if ($MaximumFrames -gt 0) {
        $tierFiles = @($tierFiles | Select-Object -First $MaximumFrames)
    }
    $warmFiles += $tierFiles
}
$totalBytes = ($warmFiles | Measure-Object -Property Length -Sum).Sum
# Allow space for cache headers, block rounding and existing operational entries.
if ($totalBytes -gt $MaximumCacheBytes * 0.95) {
    throw 'Selected assets exceed 95% of the cache budget. Select fewer tiers or increase the server budget and MaximumCacheBytes together.'
}

$handler = [System.Net.Http.SocketsHttpHandler]::new()
$handler.UseProxy = $false
$handler.MaxConnectionsPerServer = $Concurrency
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(60)
$completed = 0
$hits = 0
$misses = 0
$lastReport = [DateTime]::UtcNow
Write-Output ("Warming {0} assets ({1:N2} GiB) through {2}" -f $warmFiles.Count, ($totalBytes / 1GB), $BaseUrl)
try {
    for ($offset = 0; $offset -lt $warmFiles.Count; $offset += $Concurrency) {
        $jobs = @()
        foreach ($file in ($warmFiles | Select-Object -Skip $offset -First $Concurrency)) {
            $relativePath = $file.FullName.Substring($publicRoot.Length).TrimStart('\', '/')
            $escapedPath = (($relativePath -split '[\\/]') | ForEach-Object {
                [Uri]::EscapeDataString($_)
            }) -join '/'
            $url = [Uri]::new($baseUri, $escapedPath)
            $jobs += [pscustomobject]@{
                Url = $url
                Task = $client.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead)
            }
        }
        foreach ($job in $jobs) {
            $response = $job.Task.GetAwaiter().GetResult()
            try {
                $response.EnsureSuccessStatusCode() | Out-Null
                if (!$response.Headers.Contains('X-Asset-Cache')) {
                    throw 'The server is not running the RAM-cache profile (X-Asset-Cache is missing).'
                }
                $cacheStatus = ($response.Headers.GetValues('X-Asset-Cache') | Select-Object -First 1)
                if ($cacheStatus -eq 'HIT') {
                    $hits += 1
                } elseif ($cacheStatus -in @('MISS', 'EXPIRED')) {
                    $misses += 1
                } else {
                    throw "Asset was not cacheable ($cacheStatus): $($job.Url)"
                }
                $stream = $response.Content.ReadAsStream()
                try {
                    $stream.CopyTo([System.IO.Stream]::Null)
                } finally {
                    $stream.Dispose()
                }
                $completed += 1
            } finally {
                $response.Dispose()
            }
        }
        if (([DateTime]::UtcNow - $lastReport).TotalSeconds -ge 5) {
            Write-Output "Warmed $completed/$($warmFiles.Count) assets."
            $lastReport = [DateTime]::UtcNow
        }
    }
} finally {
    $client.Dispose()
}
Write-Output "Warm complete: $completed assets; $hits existing hits, $misses cache fills."
