import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ForgotPage() {
	return (
		<div className="min-h-dvh bg-muted/20">
			<main className="mx-auto flex max-w-5xl justify-center px-4 py-10">
				<Card className="w-full max-w-md">
					<CardHeader>
						<CardTitle>忘记密码</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="rounded-md border bg-muted/40 p-4 text-sm space-y-2">
							<p>密码重置已改为人工处理流程：</p>
							<ol className="list-decimal pl-4 space-y-1">
								<li>联系站点管理员申请重置密码</li>
								<li>管理员将生成一个 <strong>24 小时有效</strong> 的临时密码</li>
								<li>使用临时密码登录后，请立即修改密码</li>
							</ol>
							<p className="text-xs text-muted-foreground mt-2">登录页底部也提供了临时密码提示。</p>
						</div>
						<div className="flex justify-center">
							<a href="/login">
								<Button variant="outline">返回登录</Button>
							</a>
						</div>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
