#!/bin/bash
# GitHub 自动拉取脚本 - 每 5 分钟检查一次
# 不消耗 Coze 积分，纯 shell 后台运行

LOG_FILE="/app/work/logs/bypass/auto-pull.log"
REPO_DIR="${COZE_WORKSPACE_PATH:-/workspace/projects}"
INTERVAL=300  # 5 分钟

mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log "[START] 自动拉取脚本启动，检查间隔 ${INTERVAL}s"

while true; do
    cd "$REPO_DIR" 2>/dev/null || {
        sleep "$INTERVAL"
        continue
    }

    # 静默拉取远程信息
    git fetch origin --quiet 2>/dev/null

    LOCAL=$(git rev-parse HEAD 2>/dev/null)
    REMOTE=$(git rev-parse origin/main 2>/dev/null)

    if [ -z "$LOCAL" ] || [ -z "$REMOTE" ]; then
        sleep "$INTERVAL"
        continue
    fi

    if [ "$LOCAL" != "$REMOTE" ]; then
        log "[UPDATE] 检测到新代码，本地: ${LOCAL:0:7} 远程: ${REMOTE:0:7}"

        # 先检查是否有未提交的本地修改
        if ! git diff --quiet HEAD; then
            log "[WARN] 存在本地未提交修改，暂不自动拉取"
            sleep "$INTERVAL"
            continue
        fi

        git reset --hard origin/main --quiet 2>/dev/null
        NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
        SUBJECT=$(git log -1 --pretty=%s 2>/dev/null)
        log "[OK] 拉取完成，当前 HEAD: ${NEW_COMMIT}"
        log "[OK] 提交信息: ${SUBJECT}"
    fi

    sleep "$INTERVAL"
done
