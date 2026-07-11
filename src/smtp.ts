// SMTP 已移除: 密码重置改为管理员生成24h临时密码
// 保留此文件避免引用错误，所有发送操作转为空操作

export async function sendEmail(
	to: string,
	subject: string,
	html: string,
	env: any
): Promise<{ success: boolean; message: string }> {
	console.log(`[SMTP已移除] 原需要发送邮件至: ${to}, 主题: ${subject}`);
	return { success: true, message: 'SMTP已移除，邮件发送功能已禁用' };
}

export async function checkMXRecord(email: string): Promise<boolean> {
	return true; // MX 检查已跳过
}
