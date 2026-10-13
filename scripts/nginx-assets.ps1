[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'reload', 'check')]
    [string]$Action = 'start',
    [string]$PublicDirectory,
    [ValidateRange(1, 65535)]
    [int]$Port = 8443,
    [ValidateSet('127.0.0.1', '0.0.0.0')]
    [string]$ListenAddress = '127.0.0.1',
    [string]$CertificatePath,
    [string]$CertificateKeyPath,
    [switch]$Http,
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $repositoryRoot '.nginx/runtime'
$configPath = Join-Path $runtimeDirectory 'nginx.conf'
$pidPath = Join-Path $runtimeDirectory 'logs/nginx.pid'
# Pinned official Windows mainline build; see docs/nginx-assets.md.
$nginxVersion = '1.31.6'
$installDirectory = Join-Path $repositoryRoot ".nginx/nginx-$nginxVersion"
$nginxExecutable = Join-Path $installDirectory 'nginx.exe'
$prefix = $runtimeDirectory.Replace('\', '/') + '/'

function Invoke-Nginx {
    param([string[]]$NginxArguments)
    & $nginxExecutable -p $prefix -c 'nginx.conf' @NginxArguments
    if ($LASTEXITCODE -ne 0) {
        throw "nginx failed with exit code $LASTEXITCODE. Check $runtimeDirectory/logs/error.log."
    }
}

function ConvertTo-NginxPath {
    param([string]$Path)
    $resolvedPath = (Resolve-Path -LiteralPath $Path).ProviderPath.Replace('\', '/')
    # Config interpolation must not interpret path characters as nginx syntax.
    if ($resolvedPath -match '["$\r\n]') {
        throw "The path contains characters unsupported by this nginx launcher: $resolvedPath"
    }
    return $resolvedPath
}

function Get-AssetServerProcess {
    if (!(Test-Path -LiteralPath $pidPath)) {
        return $null
    }
    # nginx -t can create an empty PID file on Windows without starting a server.
    $pidText = Get-Content -Raw -LiteralPath $pidPath
    if (!$pidText) {
        return $null
    }
    $pidText = $pidText.Trim()
    if ($pidText -notmatch '^[0-9]+$') {
        throw "Invalid asset-server PID file: $pidPath"
    }
    $serverProcess = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($null -ne $serverProcess -and $serverProcess.Path -ne $nginxExecutable) {
        throw 'The asset-server PID belongs to a different executable; it will not be signalled.'
    }
    return $serverProcess
}

if ($Action -eq 'stop') {
    if ($null -eq (Get-AssetServerProcess)) {
        Write-Output 'The repository asset server is already stopped.'
        return
    }
    if (!(Test-Path -LiteralPath $nginxExecutable)) {
        throw "nginx executable missing: $nginxExecutable"
    }
    Invoke-Nginx -NginxArguments @('-s', 'quit')
    Write-Output 'Requested a graceful stop of the repository asset server.'
    return
}

if (!(Test-Path -LiteralPath $nginxExecutable)) {
    if (!$Install) {
        throw 'nginx is not installed for this checkout. Run this script once with -Install.'
    }
    $downloadDirectory = Join-Path $repositoryRoot '.nginx'
    New-Item -ItemType Directory -Force -Path $downloadDirectory | Out-Null
    $archivePath = Join-Path $downloadDirectory "nginx-$nginxVersion.zip"
    Invoke-WebRequest -Uri "https://nginx.org/download/nginx-$nginxVersion.zip" -OutFile $archivePath
    Expand-Archive -LiteralPath $archivePath -DestinationPath $downloadDirectory -Force
}

if ($Action -eq 'start' -and $null -ne (Get-AssetServerProcess)) {
    throw 'An asset-server PID file already exists. Use -Action reload or -Action stop first.'
}
if ($Action -eq 'reload' -and $null -eq (Get-AssetServerProcess)) {
    throw 'The repository asset server is not running. Use -Action start first.'
}

if (!$PublicDirectory) {
    $PublicDirectory = Join-Path $repositoryRoot 'apps/6g-showcase/public'
}
if (!(Test-Path -LiteralPath $PublicDirectory -PathType Container)) {
    throw "PublicDirectory must be an existing asset directory: $PublicDirectory"
}
$publicRoot = ConvertTo-NginxPath $PublicDirectory
$mimeTypes = ConvertTo-NginxPath (Join-Path $installDirectory 'conf/mime.types')
$listen = "${ListenAddress}:$Port"
$tls = ''
$scheme = 'http'
if (!$Http) {
    if (!$CertificatePath) {
        $CertificatePath = Join-Path $repositoryRoot '.cert/localhost-cert.pem'
    }
    if (!$CertificateKeyPath) {
        $CertificateKeyPath = Join-Path $repositoryRoot '.cert/localhost-key.pem'
    }
    $certificate = ConvertTo-NginxPath $CertificatePath
    $certificateKey = ConvertTo-NginxPath $CertificateKeyPath
    $listen += ' ssl'
    $scheme = 'https'
    $tls = @"
        ssl_certificate "$certificate";
        ssl_certificate_key "$certificateKey";
        ssl_protocols TLSv1.2 TLSv1.3;
"@
}

$templatePath = Join-Path $repositoryRoot 'config/nginx/assets.conf.template'
# Threaded file I/O is supported by the Linux Docker build, not nginx/Windows.
$configuration = (Get-Content -Raw -LiteralPath $templatePath).
    Replace('${ASSET_MIME_TYPES}', $mimeTypes).
    Replace('${ASSET_WORKERS}', '1').
    Replace('${ASSET_CACHE_CONFIG}', '').
    Replace('${ASSET_ORIGIN_SERVER}', '').
    Replace('${ASSET_LOCATION_BODY}', '            try_files $uri =404;').
    Replace('${ASSET_PUBLIC_ROOT}', $publicRoot).
    Replace('${ASSET_FILE_IO}', '').
    Replace('${ASSET_LISTEN}', $listen).
    Replace('${ASSET_HTTP_LISTEN}', '').
    Replace('${ASSET_TLS}', $tls).
    Replace('${ASSET_PID}', 'logs/nginx.pid').
    Replace('${ASSET_ERROR_LOG}', 'logs/error.log')
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeDirectory 'logs') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeDirectory 'temp') | Out-Null
# Test a candidate before replacing the configuration used by a running server.
$candidatePath = Join-Path $runtimeDirectory 'nginx.candidate.conf'
[System.IO.File]::WriteAllText($candidatePath, $configuration, [System.Text.UTF8Encoding]::new($false))
& $nginxExecutable -p $prefix -c 'nginx.candidate.conf' -t
if ($LASTEXITCODE -ne 0) {
    throw "nginx configuration validation failed. Existing nginx.conf was preserved. See $candidatePath."
}
if ($Action -eq 'check') {
    Write-Output 'Asset-server configuration is valid; no running server was changed.'
    return
}
Copy-Item -LiteralPath $candidatePath -Destination $configPath

if ($Action -eq 'reload') {
    Invoke-Nginx -NginxArguments @('-s', 'reload')
} else {
    # nginx daemonises itself on Windows; keep its helper window hidden.
    Start-Process -FilePath $nginxExecutable `
        -ArgumentList @('-p', "`"$prefix`"", '-c', 'nginx.conf') `
        -WorkingDirectory $runtimeDirectory -WindowStyle Hidden
    Start-Sleep -Milliseconds 500
    if ($null -eq (Get-AssetServerProcess)) {
        throw "nginx did not start. See $runtimeDirectory/logs/error.log."
    }
}

$browserHost = if ($ListenAddress -eq '0.0.0.0') { '<machine-ip-or-hostname>' } else { 'localhost' }
Write-Output "Asset server: ${scheme}://${browserHost}:$Port/"
Write-Output "Root: $publicRoot"
Write-Output "Logs: $runtimeDirectory/logs"
