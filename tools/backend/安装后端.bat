@echo off
rem ============================================
rem  项目管理工具 - 后端一键安装（单 exe 版）
rem  1) 拷贝后端 exe 到用户目录
rem  2) 注册 Native Messaging Host（Chrome / Edge）
rem  3) 注册 projecttool:// 协议（备用拉起）
rem  4) 注册开机自启
rem  5) 立即启动后端
rem ============================================
cd /d "%~dp0"
set "DEST=%APPDATA%\项目管理工具"
set "BACKEND=项目管理工具后端.exe"

echo ============================================
echo  请确认扩展 ID（chrome://extensions 查看"项目管理工具"的 ID）
set "EXT_ID="
set /p "EXT_ID=请输入扩展 ID（直接回车使用默认 kcclobpdcclkiaehhcnbfnpniodbmlpn）: "
if "%EXT_ID%"=="" set "EXT_ID=kcclobpdcclkiaehhcnbfnpniodbmlpn"
echo  使用的扩展 ID: %EXT_ID%
echo ============================================

if not exist "%DEST%" mkdir "%DEST%"
if not exist "%BACKEND%" ( echo [错误] 未找到 %BACKEND% & pause & exit /b 1 )

copy /y "%BACKEND%" "%DEST%\%BACKEND%" >nul

rem 生成 native messaging host manifest（path 指向同一个 exe）
set "MANIFEST=%DEST%\com.projecttool.startbackend.json"
(
echo {
echo   "name": "com.projecttool.startbackend",
echo   "description": "Start ProjectTool backend",
echo   "path": "%DEST%\%BACKEND%",
echo   "type": "stdio",
echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]
echo }
) > "%MANIFEST%"

rem 注册 native messaging host（Chrome / Edge）
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.projecttool.startbackend" /ve /d "%MANIFEST%" /f >nul
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.projecttool.startbackend" /ve /d "%MANIFEST%" /f >nul

rem 注册 projecttool:// 协议（备用拉起；exe 自身识别来源参数，无参数即进入服务模式）
reg add "HKCU\Software\Classes\projecttool\shell\open\command" /ve /d "\"%DEST%\%BACKEND%\"" /f >nul

rem 注册开机自启
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "项目管理工具后端" /t REG_SZ /d "\"%DEST%\%BACKEND%\"" /f >nul

echo ============================================
echo  安装完成（已注册 Native Messaging、协议、开机自启）
echo ============================================
echo 正在启动后端...
start "" "%DEST%\%BACKEND%"
echo 后端运行地址: http://127.0.0.1:8765
echo 请勿关闭弹出的后端窗口。
pause
