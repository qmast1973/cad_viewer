$zipUrl = "https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14-win64.zip"
# 스크립트 위치 기준으로 프로젝트 루트를 계산 (어느 PC/폴더에서 실행해도 동작)
$projectRoot = Split-Path -Parent $PSScriptRoot
$destZip = Join-Path $projectRoot "libredwg-win64.zip"
$destDir = Join-Path $projectRoot "bin"

Write-Host "Downloading LibreDWG win64 binary from $zipUrl ..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $zipUrl -OutFile $destZip -UseBasicParsing

Write-Host "Extracting to $destDir ..."
if (!(Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
}
Expand-Archive -Path $destZip -DestinationPath $destDir -Force
Remove-Item $destZip -Force

Write-Host "Available executables:"
Get-ChildItem -Path $destDir -Recurse -Filter "*.exe" | Select-Object FullName
