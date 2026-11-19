param(
    [Parameter(Mandatory)][string]$BundleDirectory,
    [Parameter(Mandatory)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$config = Get-Content (Join-Path $project 'src-tauri/tauri.conf.json') -Raw -Encoding utf8 | ConvertFrom-Json
$package = Get-Content (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
if ($package.version -ne $config.version) { throw 'NSIS and package versions differ' }
$setup = @(Get-ChildItem -LiteralPath $BundleDirectory -Filter "*_$($config.version)_x64-setup.exe")
if ($setup.Count -ne 1) { throw "Expected one x64 setup with version $($config.version)" }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$path = Join-Path $Destination "KnowPaper-Preview-$($config.version)-windows-x64-setup.exe"
if (Test-Path -LiteralPath $path) { throw "Preserve existing build evidence at $path" }
Copy-Item -LiteralPath $setup[0].FullName -Destination $path
$signature = Get-AuthenticodeSignature -LiteralPath $path
$tauri = & (Join-Path $project 'node_modules/.bin/tauri.cmd') --version
if ($LASTEXITCODE) { throw 'Cannot identify the local Tauri CLI' }
$head = git -C $project rev-parse HEAD
if ($LASTEXITCODE) { throw 'Cannot identify the source commit' }
[ordered]@{
    file = Split-Path -Leaf $path
    sha256 = (Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()
    bytes = (Get-Item -LiteralPath $path).Length
    version = $config.version
    product = $config.productName
    identifier = $config.identifier
    gitHead = $head
    architecture = 'x64 (x86_64-pc-windows-msvc)'
    windows = (Get-CimInstance Win32_OperatingSystem).Version
    tauri = $tauri
    rust = rustc -Vv
    node = node -v
    signatureStatus = $signature.Status.ToString()
    signer = $signature.SignerCertificate.Subject
    recordedAtUtc = [DateTime]::UtcNow.ToString('o')
    bundleWriteAtUtc = $setup[0].LastWriteTimeUtc.ToString('o')
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Destination 'manifest.json')
