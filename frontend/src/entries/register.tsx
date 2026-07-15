import { mount } from '@/entries/bootstrap';
import { LoginPage } from '@/pages/login-page';

// 注册已合并到登录页，直接显示同一组件
mount('root', <LoginPage />);