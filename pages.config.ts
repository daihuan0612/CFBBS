/**
 * Cloudflare Pages 部署配置
 * 注意: 当前架构使用前端直连 Worker，不使用 Pages Functions。
 * 此文件保留用于 wrangler pages deploy 命令的兼容性。
 */

export default {
	projectName: 'cfbbs',
	
	build: {
		command: 'npm run build:frontend',
		outputDir: 'public'
	},
	
	dev: {
		port: 3010,
		local: true
	}
};
