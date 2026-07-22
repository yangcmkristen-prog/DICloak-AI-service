import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DICloak 客户运营助手',
    template: '%s | DICloak 客户运营助手',
  },
  description:
    'DICloak 客户运营助手 - AI 自动总结客户画像、历史问题和功能需求',
  keywords: [
    'DICloak',
    '客户运营助手',
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
    title: 'DICloak 客户运营助手',
    description:
      'AI 自动总结客户画像、历史问题和功能需求，帮助客服快速决策。',
    siteName: 'DICloak 客户运营助手',
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
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
