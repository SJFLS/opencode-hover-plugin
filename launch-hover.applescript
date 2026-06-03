-- Silent background launch: no Terminal window; the helper detaches and keeps
-- running; logs go to /tmp/opencode-hover.log. $HOME expands to the current user.
do shell script "nohup bash $HOME/.local/share/opencode/hover-plugin/start-opencode-hover.command >/tmp/opencode-hover.log 2>&1 &"
