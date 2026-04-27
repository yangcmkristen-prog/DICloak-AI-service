import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DICloak 客服助手',
    template: '%s | DICloak 客服助手',
  },
  description:
    'DICloak 客服助手 - 智能生成推荐回复，提升客服效率',
  keywords: [
    'DICloak',
    '客服助手',
    '智能客服',
    'AI 回复生成',
    '知识库',
  ],
  authors: [{ name: 'DICloak Team' }],
  generator: 'DICloak',
  // icons: {
  //   icon: '',
  // },
  openGraph: {
    title: 'DICloak 客服助手',
    description:
      '智能生成推荐回复，提升客服效率。支持多对话管理、知识库配置。',
    siteName: 'DICloak 客服助手',
    locale: 'zh_CN',
    type: 'website',
  },
  //   // images: [''],
  // },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="en">
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
