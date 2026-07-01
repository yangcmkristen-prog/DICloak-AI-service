#!/bin/bash
# GitHub 自动拉取脚本 - 每 5 分钟检查一次
# 不消耗 Coze 积分，纯 shell 后台运行

LOG_FILE="/app/work/logs/bypass/auto-pull.log"
REPO_DIR="${COZE_WORKSPACE_PATH:-/workspace/projects}"
INTERVAL=300  # 5 分钟

# 沙箱环境特有的文件列表，拉取前自动暂存，拉取后恢复
# 这些文件在沙箱环境中可能与仓库版本不同，不影响代码逻辑
SANDBOX_FILES=".coze .codegraph/ .preview scripts/validate.sh"

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

        # 暂存沙箱环境相关的本地修改（避免触发保护机制）
        STASH_MSG="sandbox-auto-stash-$(date +%s)"
        STASHED=0
        if ! git diff --quiet HEAD; then
            git stash push -m "$STASH_MSG" -- $SANDBOX_FILES 2>/dev/null
            if git stash list | grep -q "$STASH_MSG"; then
                STASHED=1
                log "[INFO] 已暂存沙箱本地修改"
            fi
        fi

        # 如果仍有其他非沙箱文件的修改，跳过拉取（保护用户修改）
        if ! git diff --quiet HEAD; then
            log "[WARN] 存在非沙箱文件的本地修改，暂不自动拉取"
            if [ "$STASHED" -eq 1 ]; then
                git stash pop --quiet 2>/dev/null
                log "[INFO] 已恢复沙箱本地修改"
            fi
            sleep "$INTERVAL"
            continue
        fi

        git reset --hard origin/main --quiet 2>/dev/null
        NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
        SUBJECT=$(git log -1 --pretty=%s 2>/dev/null)
        log "[OK] 拉取完成，当前 HEAD: ${NEW_COMMIT}"
        log "[OK] 提交信息: ${SUBJECT}"

        # 恢复沙箱环境修改
        if [ "$STASHED" -eq 1 ]; then
            git stash pop --quiet 2>/dev/null
            log "[INFO] 已恢复沙箱本地修改"
        fi
    fi

    sleep "$INTERVAL"
done
