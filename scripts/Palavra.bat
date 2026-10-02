@echo off
setlocal
cd /d "%~dp0"
title Chiesa Il Faro
color 0F
echo.
echo   Starting Chiesa Il Faro...
echo   Do not close this window while the service is running.
echo.

if exist "node\node.exe" (
  "node\node.exe" server.cjs
) else if exist "ChiesaIlFaro.exe" (
  ChiesaIlFaro.exe
) else if exist "Palavra.exe" (
  Palavra.exe
) else (
  echo Could not find node\node.exe or ChiesaIlFaro.exe
  echo Copy the entire dist-windows folder to this computer.
  echo.
  pause
  exit /b 1
)

if errorlevel 1 (
  echo.
  echo Chiesa Il Faro stopped with an error.
  echo Open palavra.log in this folder for details.
  echo.
  pause
)
