import * as XLSX from "xlsx";

export const customerImportHeaders = [
  "团队ID", "联系人", "联系方式", "渠道", "地区", "客户类型", "客户状态", "当前套餐", "套餐月费", "创建时间", "到期时间",
  "使用场景", "用户规模", "账号规模", "竞品使用情况", "核心需求", "选择原因", "流失原因",
] as const;

export type CustomerImportRow = {
  teamId: string;
  contactName?: string;
  contactDetail?: string;
  contactMethod?: string;
  customerType?: string;
  useCase?: string;
  userScale?: string;
  accountScale?: string;
  createdAt?: string;
  monthlyFee?: string;
  region?: string;
  currentPlan?: string;
  customerStatus?: string;
  dueDate?: string;
  competitorUsage?: string;
  coreNeeds?: string;
  selectionReason?: string;
  churnReason?: string;
};

type CellValue = string | number | boolean | Date | null | undefined;

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return String(value).trim();
}

export async function parseCustomerImportFile(file: File): Promise<CustomerImportRow[]> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("表格中没有可读取的工作表");

  const records = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: "", raw: true });
  return records.map((record) => ({
    teamId: cellText(record["团队ID"] ?? record["团队 ID"]),
    contactName: cellText(record["联系人"]) || undefined,
    contactDetail: cellText(record["联系方式"]) || undefined,
    contactMethod: cellText(record["渠道"]) || undefined,
    customerType: cellText(record["客户类型"]) || undefined,
    useCase: cellText(record["使用场景"]) || undefined,
    userScale: cellText(record["用户规模"]) || undefined,
    accountScale: cellText(record["账号规模"]) || undefined,
    createdAt: cellText(record["创建时间"]) || undefined,
    monthlyFee: cellText(record["套餐月费"]) || undefined,
    region: cellText(record["地区"]) || undefined,
    currentPlan: cellText(record["当前套餐"]) || undefined,
    customerStatus: cellText(record["客户状态"]) || undefined,
    dueDate: cellText(record["到期时间"]) || undefined,
    competitorUsage: cellText(record["竞品使用情况"]) || undefined,
    coreNeeds: cellText(record["核心需求"]) || undefined,
    selectionReason: cellText(record["选择原因"]) || undefined,
    churnReason: cellText(record["流失原因"]) || undefined,
  }));
}

export function downloadCustomerImportTemplate(): void {
  const sheet = XLSX.utils.aoa_to_sheet([
    [...customerImportHeaders],
    ["DIC-示例001", "张三", "zhangsan@example.com", "WhatsApp", "中国", "代理商", "活跃", "高阶版", "49.00", "2026-07-31", "2027-07-31", "跨境电商多店铺运营", "10 人", "100 个", "Multilogin", "多账号安全运营", "性价比高", ""],
  ]);
  sheet["!cols"] = customerImportHeaders.map((header) => ({ wch: Math.max(14, header.length * 2 + 4) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "客户导入模板");
  XLSX.writeFile(workbook, "客户批量导入模板.xlsx");
}

export function exportCustomers(rows: Array<Record<(typeof customerImportHeaders)[number], string>>): void {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...customerImportHeaders] });
  sheet["!cols"] = customerImportHeaders.map((header) => ({ wch: Math.max(14, header.length * 2 + 4) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "客户信息");
  XLSX.writeFile(workbook, "客户信息导出.xlsx");
}