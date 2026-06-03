-- 后台静默启动：不开 Terminal 窗口，助手脱离终端常驻，日志写到 /tmp/opencode-hover.log
do shell script "nohup bash /Users/yeboss/.local/share/opencode/hover-plugin/start-opencode-hover.command >/tmp/opencode-hover.log 2>&1 &"
