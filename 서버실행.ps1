# =====================================================================
#  스터디 드래곤 - 간단 서버
# ---------------------------------------------------------------------
#  왜 필요한가?
#    index.html을 그냥 더블클릭하면 Firebase가 작동하지 않습니다.
#    <script type="module">은 file:// 주소에서 브라우저 보안정책(CORS)에
#    막히기 때문입니다. 그래서 http:// 주소로 열어야 합니다.
#
#  쓰는 법
#    이 파일에서 마우스 우클릭 → "PowerShell에서 실행"
#    또는 터미널에서:  powershell -ExecutionPolicy Bypass -File .\서버실행.ps1
#
#    끄려면 이 창에서 Ctrl+C
#
#  (VS Code의 Live Server 확장을 쓴다면 이 파일은 필요 없습니다.)
# =====================================================================

$port = 5500
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "  [X] $port 포트를 열 수 없습니다." -ForegroundColor Red
    Write-Host "      이미 다른 프로그램이 쓰고 있을 수 있어요." -ForegroundColor Yellow
    Write-Host "      이 파일을 열어서 맨 위 `$port 값을 5501 같은 다른 숫자로 바꿔보세요." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "엔터를 누르면 닫힙니다"
    exit 1
}

Write-Host ""
Write-Host "  🐉 스터디 드래곤 서버가 켜졌습니다!" -ForegroundColor Green
Write-Host ""
Write-Host "     http://localhost:$port" -ForegroundColor Cyan
Write-Host ""
Write-Host "  브라우저가 자동으로 열립니다. 끄려면 Ctrl+C" -ForegroundColor DarkGray
Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray

Start-Process "http://localhost:$port"

$types = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".ico"  = "image/x-icon"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $path = $ctx.Request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }

        # 상위 폴더 탈출(../) 차단
        $full = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
        $full = [System.IO.Path]::GetFullPath($full)

        if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) {
            $ctx.Response.StatusCode = 403
            $ctx.Response.Close()
            continue
        }

        if (Test-Path $full -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($full).ToLower()
            $ctx.Response.ContentType = $types[$ext]
            if (-not $ctx.Response.ContentType) { $ctx.Response.ContentType = "application/octet-stream" }

            # 코드를 고치면 새로고침으로 바로 반영되도록 캐시 끄기
            $ctx.Response.Headers.Add("Cache-Control", "no-store")

            $bytes = [System.IO.File]::ReadAllBytes($full)
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host ("  200  " + $path) -ForegroundColor DarkGray
        } else {
            $ctx.Response.StatusCode = 404
            Write-Host ("  404  " + $path) -ForegroundColor Red
        }
        $ctx.Response.Close()
    } catch {
        # Ctrl+C로 껐을 때 빨간 에러가 쏟아지지 않도록
        if ($listener.IsListening) { Write-Host "  ! $($_.Exception.Message)" -ForegroundColor DarkYellow }
    }
}
