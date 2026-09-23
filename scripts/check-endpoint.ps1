# اختبار سريع للـ endpoint من جهازك (ويندوز)
# الاستخدام:
#   powershell -ExecutionPolicy Bypass -File scripts\check-endpoint.ps1 -Url https://xxxx.onrender.com/agent

param(
  [Parameter(Mandatory = $true)][string]$Url
)

$samplePath = Join-Path $PSScriptRoot '..\example-request.json'
$json = Get-Content -Raw -Encoding UTF8 $samplePath
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

Write-Host "POST $Url" -ForegroundColor Cyan
$started = Get-Date

try {
  $response = Invoke-WebRequest -Uri $Url -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' -UseBasicParsing
  $elapsed = [int]((Get-Date) - $started).TotalMilliseconds
  Write-Host "الحالة: $($response.StatusCode)  (خلال $elapsed مللي ثانية)" -ForegroundColor Green
  Write-Host "الرد الخام:" -ForegroundColor Cyan
  $response.Content
  Write-Host ""
  $parsed = $response.Content | ConvertFrom-Json
  if ($parsed.type -eq 'table') {
    Write-Host "نوع الرد: جدول فيه $($parsed.rows.Count) صف و $($parsed.columns.Count) عمود" -ForegroundColor Green
  } elseif ($parsed.type -eq 'text') {
    Write-Host "نوع الرد: نص" -ForegroundColor Green
  } else {
    Write-Host "تحذير: الشكل غير متوقع (لازم يكون type = table أو text)" -ForegroundColor Yellow
  }
} catch {
  Write-Host "فشل الطلب: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails.Message) {
    Write-Host "تفاصيل من السيرفر:" -ForegroundColor Red
    $_.ErrorDetails.Message
  }
  exit 1
}
