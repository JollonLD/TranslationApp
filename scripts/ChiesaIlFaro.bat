@echo off
setlocal
cd /d "%~dp0"
title Chiesa Il Faro
color 0F
echo.
echo   Starting Chiesa Il Faro...
echo   Do not close this window while the service is running.
echo.

if exist "python\python.exe" (
  set "ASR_BACKEND=whisperlivekit"
  set "WLK_BIN=%~dp0python\python.exe"
  set "WLK_MODEL=small"
  set "WLK_LANGUAGE=pt"
  set "WLK_PORT=8000"
  set "NLLB_ENABLED=1"
  set "NLLB_PYTHON=%~dp0python\python.exe"
  set "NLLB_MODEL=%~dp0models\nllb"
  set "HF_HOME=%~dp0models\hf"
  set "HUGGINGFACE_HUB_CACHE=%~dp0models\hf"
  set "PATH=%~dp0python;%PATH%"
  if exist "models\hf\hub\models--Systran--faster-whisper-small" set "HF_HUB_OFFLINE=1"
  if exist "models\nllb\config.json" set "TRANSFORMERS_OFFLINE=1"
) else (
  echo   Local Whisper runtime not found. The booth will use Chrome speech recognition.
  echo.
)

if exist "node\node.exe" (
  "node\node.exe" server.cjs
) else (
  echo Could not find node\node.exe
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
