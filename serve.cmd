@echo off
REM ===========================================================================
REM  Start OpsPulse locally.
REM
REM  The apps are ES modules, which browsers refuse to load over file:// — so
REM  they must be served over http. This just starts a static server; there is
REM  no build step and nothing to install.
REM ===========================================================================
setlocal
set PORT=5500

echo.
echo   OpsPulse AI — starting a local server on port %PORT%
echo.
echo     Live Ops Floor  (start here)   http://localhost:%PORT%/demo.html
echo     OpsPulse alone                 http://localhost:%PORT%/opspulse.html
echo     NorthDesk alone                http://localhost:%PORT%/servicedesk.html
echo     Marketing site                 http://localhost:%PORT%/index.html
echo.
echo   Press Ctrl+C to stop.
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/demo.html
  python -m http.server %PORT%
  goto :eof
)

where npx >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/demo.html
  npx --yes serve . -l %PORT%
  goto :eof
)

echo   Neither python nor npx was found on PATH.
echo   Install either one, or serve this folder with any static web server.
pause
