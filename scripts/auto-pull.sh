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

        # 检查是否有本地改动（包括已跟踪文件修改和未跟踪新文件）
        HAS_CHANGES=0
        if ! git diff --quiet HEAD 2>/dev/null; then
            HAS_CHANGES=1
        elif [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
            HAS_CHANGES=1
        fi

        # 如果有本地改动，先全部暂存
        STASHED=0
        if [ "$HAS_CHANGES" -eq 1 ]; then
            STASH_MSG="sandbox-auto-stash-$(date +%s)"
            git stash push -u -m "$STASH_MSG" --quiet 2>/dev/null
            if git stash list | grep -q "$STASH_MSG"; then
                STASHED=1
                log "[INFO] 已暂存所有本地修改（包括未跟踪文件）"
            else
                log "[WARN] 暂存失败，跳过本次拉取"
                sleep "$INTERVAL"
                continue
            fi
        fi

        # 执行拉取
        git reset --hard origin/main --quiet 2>/dev/null
        NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
        SUBJECT=$(git log -1 --pretty=%s 2>/dev/null)
        log "[OK] 拉取完成，当前 HEAD: ${NEW_COMMIT}"
        log "[OK] 提交信息: ${SUBJECT}"

        # 恢复本地修改
        if [ "$STASHED" -eq 1 ]; then
            if git stash pop --quiet 2>/dev/null; then
                log "[INFO] 已恢复本地修改"
            else
                log "[WARN] 恢复本地修改时出现冲突，已保留在 stash 中"
                log "[WARN] 可手动执行 'git stash pop' 恢复"
            fi
        fi
    fi

    sleep "$INTERVAL"
done
