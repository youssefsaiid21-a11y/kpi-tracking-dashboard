$env:NODE_ENV = "production"
Set-Location $PSScriptRoot
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js" -Wait
