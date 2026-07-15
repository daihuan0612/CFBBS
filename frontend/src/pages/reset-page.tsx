import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ResetPage() {
	return (
		<div className="min-h-dvh bg-muted/20">
			<main className="mx-auto flex max-w-5xl justify-center px-4 py-10">
				<Card className="w-full max-w-md">
					<CardHeader>
						<CardTitle>重置密码</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="rounded-md border bg-muted/40 p-4 text-sm space-y-2">
							<p>密码重置方式已变更：</p>
							<ol className="list-decimal pl-4 space-y-1">
								<li>联系管理员申请重置密码</li>
								<li>管理员会提供 <strong>24 小时有效</strong> 的临时密码</li>
								<li>使用临时密码直接 <a href="/login" className="underline">登录</a></li>
								<li>登录后进入 <a href="/settings" className="underline">设置页面</a> 修改密码</li>
							</ol>
						</div>
						<div className="flex justify-center gap-3">
							<a href="/login"><Button variant="outline">返回登录</Button></a>
							<a href="/settings"><Button>修改密码</Button></a>
						</div>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
