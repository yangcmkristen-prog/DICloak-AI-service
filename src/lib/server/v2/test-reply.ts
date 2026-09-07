import type { ProductName } from '@/lib/types';
import { V2_SYSTEM_PROMPT } from './prompt';

export function createV2TestReply(product: ProductName): string {
  const productLabel = product === 'paraturbo' ? 'Paraturbo' : 'DICloak';
  void V2_SYSTEM_PROMPT;
  return `V2 测试链路已连接。当前产品：${productLabel}。`;
}
