$d = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $d
python gen_slide.py | Out-Null
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$jobs = @(@("architecture_710x240", 710, 240), @("techstack_710x372", 710, 372))
foreach ($j in $jobs) {
  $name = $j[0]; $w = $j[1]; $h = $j[2]
  & $edge --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=3 "--window-size=$w,$h" "--screenshot=$d\$name.png" "file:///$($d -replace '\\','/')/$name.svg" 2>$null | Out-Null
}
Get-ChildItem *.png | Select-Object Name, Length
