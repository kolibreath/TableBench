@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
echo ============================================
echo   项目管理工具后端 EXE 构建脚本
echo ============================================
cd /d "%~dp0"

rem ------------------------------------------------------------------
rem 预检查：确认离线依赖与 wheels
rem ------------------------------------------------------------------
echo.
echo [预检查] 校验关键 wheels...
set "MISSING_COUNT=0"
for %%p in (pyinstaller lxml markupsafe charset_normalizer pywin32) do (
    set "FOUND="
    for /f %%f in ('dir /b wheels\%%p-*-win_amd64.whl 2^>nul') do set "FOUND=1"
    if not defined FOUND (
        echo   [缺失] %%p
        set /a MISSING_COUNT+=1
    ) else (
        echo   [就绪] %%p
    )
)
if %MISSING_COUNT% gtr 0 (
    echo.
    echo [错误] 有 %MISSING_COUNT% 个关键依赖缺失，请核对 wheels 目录。
    pause
    exit /b 1
)

echo.
echo [1/3] 离线安装运行依赖（python-docx + flask + pywin32 等）...
pip install --no-index --find-links=wheels\ -r requirements-server.txt
if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查上方 pip 输出。
    pause
    exit /b 1
)

echo.
echo [2/3] 确认 pyinstaller...
where pyinstaller >nul 2>nul
if errorlevel 1 (
    pip install --no-index --find-links=wheels\ pyinstaller
    if errorlevel 1 (
        echo [错误] pyinstaller 安装失败。
        pause
        exit /b 1
    )
)

echo.
echo [3/3] 构建 项目管理工具后端.exe ...
pyinstaller --onefile --console --name 项目管理工具后端 ^
    --paths="%~dp0." ^
    --paths="%~dp0vendor_pkgs" ^
    --hidden-import ai_provider ^
    --hidden-import parser ^
    --hidden-import olefile ^
    --hidden-import version_manager ^
    --hidden-import doc_engine ^
    --hidden-import storage_service ^
    --hidden-import check_docs ^
    --hidden-import workhours_service ^
    --hidden-import win32com.client ^
    --hidden-import pythoncom ^
    --hidden-import win32api ^
    --add-data "ai_provider.py;." ^
    --add-data "version_manager.py;." ^
    --add-data "doc_engine.py;." ^
    --add-data "storage_service.py;." ^
    --add-data "check_docs.py;." ^
    --add-data "templates.json;." ^
    --add-data "version.json;." ^
    --add-data "update_config.json;." ^
    --add-data "AI_BASE_URLS.json;." ^
    --add-data "vendor_pkgs;vendor_pkgs" ^
    server.py
if errorlevel 1 (
    echo [错误] EXE 构建失败，请检查上方 pyinstaller 输出。
    pause
    exit /b 1
)

rem 把安装脚本一并放入 dist（安装时 exe 与 bat 需同目录）
if exist "%~dp0安装后端.bat" copy /y "%~dp0安装后端.bat" "dist\" >nul

echo.
echo ============================================
echo   构建完成！
echo   输出: dist\项目管理工具后端.exe
echo ============================================
echo.
echo 下一步：进入 dist 目录，双击 安装后端.bat 完成注册与启动。
echo 后端监听地址: http://127.0.0.1:8765
pause
