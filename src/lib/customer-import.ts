import * as XLSX from "xlsx";

export const customerImportHeaders = ["团队ID", "创建时间", "套餐月费", "地区", "当前套餐", "客户状态"] as const;

export type CustomerImportRow = {
  teamId: string;
  createdAt?: string;
  monthlyFee?: string;
  region?: string;
  currentPlan?: string;
  customerStatus?: string;
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
    createdAt: cellText(record["创建时间"]) || undefined,
    monthlyFee: cellText(record["套餐月费"]) || undefined,
    region: cellText(record["地区"]) || undefined,
    currentPlan: cellText(record["当前套餐"]) || undefined,
    customerStatus: cellText(record["客户状态"]) || undefined,
  }));
}

export function downloadCustomerImportTemplate(): void {
  const sheet = XLSX.utils.aoa_to_sheet([
    [...customerImportHeaders],
    ["DIC-示例001", "2026-07-31", "49.00", "中国", "Plus", "活跃"],
  ]);
  sheet["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "客户导入模板");
  XLSX.writeFile(workbook, "客户批量导入模板.xlsx");
}