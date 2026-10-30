param(
  [Parameter(Mandatory = $true)]
  [string]$PathList
)

$ErrorActionPreference = 'Continue'
$shell = New-Object -ComObject Shell.Application
$nsCache = @{}
$dateColCache = @{}

function Convert-PropDate($value) {
  if ($null -eq $value -or $value -eq '') { return $null }
  if ($value -is [datetime]) { return $value }
  if ($value -is [double] -or $value -is [decimal] -or $value -is [int] -or $value -is [long]) {
    try { return [DateTime]::FromOADate([double]$value) } catch { return $null }
  }
  try { return [datetime]$value } catch { return $null }
}

function Parse-DisplayedDate([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $trimmed = $text.Trim()
  foreach ($culture in @([cultureinfo]::CurrentCulture, [cultureinfo]'pt-BR', [cultureinfo]'en-US', [cultureinfo]::InvariantCulture)) {
    try { return [datetime]::Parse($trimmed, $culture) } catch {}
  }
  return $null
}

function Get-DateColumnIndex($ns) {
  $key = [string]$ns.Self.Path
  if ($dateColCache.ContainsKey($key)) { return $dateColCache[$key] }
  $index = $null
  for ($i = 0; $i -lt 500; $i++) {
    $header = $ns.GetDetailsOf($null, $i)
    if ($header -eq 'Data' -or $header -eq 'Date') {
      $index = $i
      break
    }
  }
  $dateColCache[$key] = $index
  return $index
}

function Get-ExplorerDate([string]$filePath) {
  $dir = [IO.Path]::GetDirectoryName($filePath)
  $name = [IO.Path]::GetFileName($filePath)
  if (-not $nsCache.ContainsKey($dir)) {
    $nsCache[$dir] = $shell.Namespace($dir)
    if (-not $nsCache[$dir]) { $nsCache[$dir] = $shell.Namespace(($dir.TrimEnd('\') + '\')) }
  }
  $ns = $nsCache[$dir]
  $displayed = $null
  $precise = $null

  if ($ns) {
    $item = $ns.ParseName($name)
    if ($item) {
      $col = Get-DateColumnIndex $ns
      if ($null -ne $col) {
        $displayed = Parse-DisplayedDate ($ns.GetDetailsOf($item, $col))
      }
      foreach ($prop in @('System.Photo.DateTaken', 'System.Media.DateEncoded', 'System.ItemDate')) {
        $precise = Convert-PropDate ($item.ExtendedProperty($prop))
        if ($precise) { break }
      }
    }
  }

  if ($displayed -and $precise) {
    if (
      $displayed.Year -eq $precise.Year -and
      $displayed.Month -eq $precise.Month -and
      $displayed.Day -eq $precise.Day -and
      $displayed.Hour -eq $precise.Hour -and
      $displayed.Minute -eq $precise.Minute
    ) {
      return $precise
    }
    return $displayed
  }
  if ($displayed) { return $displayed }
  if ($precise) { return $precise }
  return (Get-Item -LiteralPath $filePath).LastWriteTime
}

$paths = Get-Content -LiteralPath $PathList -Encoding UTF8 | Where-Object { $_.Trim() -ne '' }
foreach ($raw in $paths) {
  $filePath = $raw.Trim().TrimStart([char]0xFEFF)
  if (-not $filePath) { continue }
  try {
    $dt = Get-ExplorerDate $filePath
    $local = [DateTime]::SpecifyKind($dt, [DateTimeKind]::Local)
    $ms = ([DateTimeOffset]$local).ToUnixTimeMilliseconds()
    Write-Output ("{0}`t{1:yyyy-MM-ddTHH:mm:ss}`t{2}" -f $filePath, $local, $ms)
  } catch {
    Write-Output ("{0}`t" -f $filePath)
  }
}
