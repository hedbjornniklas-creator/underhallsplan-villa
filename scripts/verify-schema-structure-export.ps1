param(
  [Parameter(Mandatory = $true)][string]$InputCsv,
  [string]$OutputJson = '.cache/inspection-schema-export/production-schema-review.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privateRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.cache/inspection-schema-export'))
$outputPath = [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputJson))
if (-not $outputPath.StartsWith($privateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output must stay inside the git-ignored .cache/inspection-schema-export directory.'
}
if (Test-Path -LiteralPath $outputPath) { throw 'Output already exists; choose a new filename. No file was overwritten.' }
$inputFile = Get-Item -LiteralPath $InputCsv
if ($inputFile.Length -gt 64MB) { throw 'Export is unexpectedly large; inspect it before proceeding.' }
$rows = @(Import-Csv -LiteralPath $inputFile.FullName -Encoding UTF8)
if ($rows.Count -eq 0) { throw 'No export parts found.' }
$expectedColumns = @('part_no','part_count','json_bytes','json_md5','payload_base64')
foreach ($column in $expectedColumns) {
  if ($column -notin $rows[0].PSObject.Properties.Name) { throw "Missing export column: $column" }
}
$parts = $rows | Sort-Object { [int]$_.part_no }
$partCount = [int]$parts[0].part_count
$jsonBytes = [int]$parts[0].json_bytes
$expectedHash = [string]$parts[0].json_md5
if ($partCount -lt 1 -or $partCount -gt 4096 -or $rows.Count -ne $partCount) { throw 'Incomplete export: not all parts were downloaded.' }
if ($jsonBytes -lt 1 -or $jsonBytes -gt 48MB -or $expectedHash -notmatch '^[0-9a-f]{32}$') { throw 'Invalid export manifest.' }
$payload = [Text.StringBuilder]::new()
for ($i = 0; $i -lt $partCount; $i++) {
  $part = $parts[$i]
  if ([int]$part.part_no -ne ($i + 1) -or [int]$part.part_count -ne $partCount -or
      [int]$part.json_bytes -ne $jsonBytes -or $part.json_md5 -cne $expectedHash) {
    throw 'Mismatched, duplicated or missing export parts.'
  }
  if ($part.payload_base64.Length -lt 1 -or $part.payload_base64.Length -gt 32768 -or
      $part.payload_base64 -notmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'Invalid payload encoding.' }
  [void]$payload.Append($part.payload_base64)
}
$bytes = [Convert]::FromBase64String($payload.ToString())
$md5 = [Security.Cryptography.MD5]::Create()
try { $actualHash = [BitConverter]::ToString($md5.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }
finally { $md5.Dispose() }
if ($bytes.Length -ne $jsonBytes -or $actualHash -cne $expectedHash) { throw 'Export checksum/length mismatch; no output written.' }
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$json = $utf8.GetString($bytes)
$report = $json | ConvertFrom-Json
if ($report.format_version -ne 1 -or $report.purpose -ne 'schema_review_not_restore' -or
    $report.transaction_read_only -ne 'on' -or $report.transaction_isolation -ne 'repeatable read') {
  throw 'Unexpected export type or transaction mode.'
}
if (@($report.sections.PSObject.Properties).Count -ne 23 -or @($report.counts.PSObject.Properties).Count -ne 23) {
  throw 'Unexpected section count.'
}
foreach ($section in $report.sections.PSObject.Properties) {
  if ($section.Name -notin $report.counts.PSObject.Properties.Name -or
      @($section.Value).Count -ne [int]$report.counts.($section.Name)) { throw "Section count mismatch: $($section.Name)" }
}

# Data is written only after validation, and never into a tracked source folder.
[void][IO.Directory]::CreateDirectory($privateRoot)
$stream = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try { $stream.Write($bytes, 0, $bytes.Length) }
finally { $stream.Dispose() }
[PSCustomObject]@{
  Verified = $true
  OutputPath = $outputPath
  Parts = $partCount
  JsonBytes = $bytes.Length
  Md5 = $actualHash
  ServerVersion = $report.server_version
  Counts = $report.counts
} | ConvertTo-Json -Depth 4
