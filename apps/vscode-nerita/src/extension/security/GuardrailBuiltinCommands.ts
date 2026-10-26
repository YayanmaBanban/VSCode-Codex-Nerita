// 既知の危険カテゴリをコマンド本文から検出し、カテゴリごとの拒否・承認を共通判定へ追加する。
import type { GuardrailsConfig } from "@nerita/shared/guardrails/config";
import { builtinCommandDefinitions } from "@nerita/shared/guardrails/builtins";
import type { GuardResult } from "@nerita/shared/guardrails/messages";
import { addFinding } from "./GuardrailPaths";

const patterns = {
	git: /\bgit\b[^\r\n;|&]+\b(?:reset|clean|rebase|restore|filter-branch|filter-repo|replace|update-ref|reflog|prune)\b|\bgit\b[^\r\n;|&]+\b(?:push|branch|tag|checkout|switch|commit|gc|notes)\b[^\r\n;|&]*(?:--force(?:-with-lease)?|--delete|--amend|--fixup|--squash|--prune|--hard|\s-[df])\b/i,
	filesystem:
		/\b(?:remove-item|rm|rmdir|del|erase|truncate|shred|dd|mkfs|wipefs|parted|fdisk|sfdisk|sgdisk|format-volume|clear-disk)\b|\bfind\b[^\r\n;|&]*-delete\b/i,
	containers:
		/\b(?:docker|podman)\b[^\r\n;|&]+\b(?:rm|rmi|prune)\b|\b(?:docker\s+compose|docker-compose|podman\s+compose)\b[^\r\n;|&]+\bdown\b[^\r\n;|&]*(?:-v\b|--volumes\b)/i,
	packages:
		/\b(?:npm|pnpm|yarn|bun)\s+(?:uninstall|remove|rm|prune|autoclean)\b|\b(?:pip|pip3|uv)\s+(?:uninstall|remove)\b|\bcargo\s+remove\b|\b(?:apt|apt-get|dnf|yum)\s+(?:remove|purge|autoremove)\b|\b(?:pacman|paru|yay)\s+-R/,
	system: /\b(?:sudo|shutdown|reboot|poweroff|killall|pkill|kill|stop-process|restart-computer|stop-computer|mount|umount|swapon|swapoff|chmod|chown|setfacl|icacls|set-acl)\b|\bsystemctl\s+(?:stop|disable|mask|restart)\b/i,
	database:
		/\b(?:drop\s+(?:database|schema|table|index)|truncate(?:\s+table)?|delete\s+from|update\s+\S+\s+set|alter\s+table[^;\r\n]+\bdrop)\b/i,
	secrets:
		/(?:\.env(?:\.[\w.-]+)?|\.envrc|\.ssh|\.aws|\.gnupg|\.git-credentials|\bauth\.json|\bid_(?:rsa|ed25519|dsa|ecdsa)|\.npmrc|\.pypirc|\.netrc|\.kube[\\/]config|\.config[\\/](?:gh[\\/]hosts\.yml|gcloud)|[\w.-]+\.(?:pem|key|p12|pfx|kdbx))\b/i,
};

/** 静的な危険パターンだけを検出し、引用文や任意スクリプトの安全性まで保証しない。 */
export function inspectBuiltinCommands(
	config: GuardrailsConfig,
	command: string,
	result: GuardResult,
) {
	for (const definition of builtinCommandDefinitions) {
		if (patterns[definition.id].test(command)) {
			addFinding(
				result,
				config.builtins.commands[definition.id],
				`builtin:command:${definition.id}`,
				definition.name,
			);
		}
	}
}
