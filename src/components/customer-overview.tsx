"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Globe2, MessageCircle, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { downloadCustomerImportTemplate, parseCustomerImportFile, type CustomerImportRow } from "@/lib/customer-import";

type IssueStatus = "未处理" | "处理中" | "已解决";
type Issue = { title: string; description: string; resolution: string; status: IssueStatus; date: string };
type FeatureStatus = "未评估" | "已评估" | "已上线" | "暂无法实现" | "已有可实现方案";
type Feature = { title: string; description: string; status: FeatureStatus; date: string };
type FollowUpStatus = "待跟进" | "无需跟进" | "已跟进";
type FollowUpType = "功能回访" | "试用回访" | "需求调研" | "客户背景调研";
type FollowUp = { date: string; type: FollowUpType; result: string };
type Customer = {
  id: string; name: string; initials: string; teamId: string; channel: string; contact: string;
  region: string; scenario: string; type: string; users: string; accounts: string; plan: string; monthlyFee: string;
  status: "活跃" | "流失风险" | "已停滞" | "潜在客户"; createdAt: string; updatedAt: string; note: string; issues: Issue[]; features: Feature[];
  competitorUsage: string; coreNeeds: string; selectionReason: string; churnReason: string; followUpStatus: FollowUpStatus; followUps: FollowUp[];
};

type SummaryPayload = Partial<Omit<Customer, "id" | "name" | "initials" | "channel" | "contact" | "scenario" | "users" | "accounts" | "type" | "issues" | "features" | "followUps">> & {
  externalChatId?: string; contactName?: string; contactMethod?: string; contactDetail?: string; useCase?: string; userScale?: string; accountScale?: string; customerType?: string;
  currentPlan?: string; monthlyFee?: string; createdAt?: string; customerStatus?: string; notes?: string;
  issues?: Array<Partial<Issue> & { occurredAt?: string }>;
  featureRequests?: Array<Partial<Feature> & { requestedAt?: string }>;
  competitorUsage?: string; coreNeeds?: string; selectionReason?: string; churnReason?: string; followUpStatus?: string;
  followUps?: Array<Partial<FollowUp> & { followedAt?: string }>;
};

const statusStyle: Record<Customer["status"], string> = {
  活跃: "border-emerald-100 bg-emerald-50 text-emerald-700", 流失风险: "border-red-100 bg-red-50 text-red-700", 已停滞: "border-slate-200 bg-slate-100 text-slate-700", 潜在客户: "border-blue-100 bg-blue-50 text-blue-700",
};

const featureStatuses: FeatureStatus[] = ["未评估", "已评估", "已有可实现方案", "暂无法实现", "已上线"];
const followUpTypes: FollowUpType[] = ["功能回访", "试用回访", "需求调研", "客户背景调研"];
const followUpStatuses: FollowUpStatus[] = ["待跟进", "无需跟进", "已跟进"];

function newestFirst<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.date.localeCompare(left.date));
}

function monthlyFeeValue(value: string): number {
  const normalized = value.replace(/[^\d.-]/g, "");
  if (!normalized) return -1;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : -1;
}

function ResizableHead({ label, width, onResize, onSort, direction, className = "" }: {
  label: string; width: number; onResize: (startX: number) => void; onSort?: () => void;
  direction?: "asc" | "desc"; className?: string;
}) {
  return <TableHead className={`relative select-none ${className}`} style={{ width, minWidth: width, maxWidth: width }}>
    {onSort ? <button className="flex w-full items-center gap-1 text-left" onClick={onSort}>{label}{direction === "asc" ? <ArrowUp className="size-3" /> : direction === "desc" ? <ArrowDown className="size-3" /> : null}</button> : label}
    <span role="separator" aria-orientation="vertical" aria-label={`调整${label}列宽`} className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none" onMouseDown={(event) => { event.preventDefault(); onResize(event.clientX); }} />
  </TableHead>;
}

function formatInUtc8(value: string, includeTime: boolean): string {
  if (!value || value === "—") return "—";
  const dateOnlyMatch = value.trim().match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})\D?$/);
  if (!includeTime && dateOnlyMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2].padStart(2, "0")}-${dateOnlyMatch[3].padStart(2, "0")}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" as const } : {}),
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const formattedDate = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
  return includeTime ? `${formattedDate} ${getPart("hour")}:${getPart("minute")}:${getPart("second")}` : formattedDate;
}

export function CustomerOverview() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [issueQuery, setIssueQuery] = useState("");
  const [featureQuery, setFeatureQuery] = useState("");
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState("all");
  const [quickFilter, setQuickFilter] = useState<"all" | Customer["status"] | FollowUpStatus>("all");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [jumpPage, setJumpPage] = useState("1");
  const [followUpCustomerId, setFollowUpCustomerId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sort, setSort] = useState<{ key: "monthlyFee" | "createdAt"; direction: "asc" | "desc" } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    name: 150, teamId: 130, contact: 170, region: 110, plan: 110, monthlyFee: 120,
    scenario: 210, status: 110, followUpStatus: 110, createdAt: 130, updatedAt: 170, action: 80,
  });
  const selected = customers.find((customer) => customer.id === selectedId) ?? null;

  const loadCustomers = useCallback(async (showSuccess = false) => {
    setLoading(true);
    try {
      await fetch("/api/copilot/customer-summary", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("客户数据加载失败");
        return await response.json() as { customers?: SummaryPayload[] };
      })
      .then(({ customers: records = [] }) => {
        const normalized = records.flatMap((record): Customer[] => {
          if (!record.externalChatId || !record.contactName) return [];
          const status: Customer["status"] = record.customerStatus === "流失风险" || record.customerStatus === "已停滞" || record.customerStatus === "潜在客户" ? record.customerStatus : "活跃";
          return [{
            id: record.externalChatId, name: record.contactName, initials: record.contactName.slice(0, 2).toUpperCase(),
            teamId: record.teamId || "—", channel: record.contactMethod || "WhatsApp", contact: record.contactDetail || record.contactName,
            region: record.region || "未知", scenario: record.useCase || "待 AI 补充", type: record.customerType || "未分类",
            users: record.userScale || "未知", accounts: record.accountScale || "未知", plan: record.currentPlan || "未知", monthlyFee: record.monthlyFee || "未知",
            status, createdAt: formatInUtc8(record.createdAt || record.updatedAt || "—", false), updatedAt: formatInUtc8(record.updatedAt || "—", true), note: record.notes || "",
            competitorUsage: record.competitorUsage || "", coreNeeds: record.coreNeeds || "", selectionReason: record.selectionReason || "", churnReason: record.churnReason || "",
            followUpStatus: followUpStatuses.includes(record.followUpStatus as FollowUpStatus) ? record.followUpStatus as FollowUpStatus : status === "活跃" ? "无需跟进" : "待跟进",
            followUps: newestFirst((record.followUps || []).map((followUp) => ({ date: formatInUtc8(followUp.followedAt || followUp.date || record.updatedAt || "", false), type: followUpTypes.includes(followUp.type as FollowUpType) ? followUp.type as FollowUpType : "客户背景调研", result: followUp.result || "" }))),
            issues: newestFirst((record.issues || []).map((issue) => ({ title: issue.title || "未命名问题", description: issue.description || "", resolution: issue.resolution || "", status: issue.status === "已解决" || issue.status === "处理中" ? issue.status : "未处理", date: formatInUtc8(issue.occurredAt || issue.date || record.updatedAt || "", false) }))),
            features: newestFirst((record.featureRequests || []).map((feature) => ({ title: feature.title || "未命名需求", description: feature.description || "", status: featureStatuses.includes(feature.status as FeatureStatus) ? feature.status as FeatureStatus : "未评估", date: formatInUtc8(feature.requestedAt || feature.date || record.updatedAt || "", false) }))),
          }];
        });
        setCustomers(normalized);
        const deepLinkedId = new URLSearchParams(window.location.search).get("customer");
        if (deepLinkedId && normalized.some((customer) => customer.id === deepLinkedId)) setSelectedId(deepLinkedId);
      });
      if (showSuccess) toast.success("客户列表已刷新");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "客户数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);
  const filtered = useMemo(() => customers.filter((customer) => {
    const keyword = query.trim().toLowerCase();
    const issueKeyword = issueQuery.trim().toLowerCase();
    const featureKeyword = featureQuery.trim().toLowerCase();
    return (!keyword || [customer.name, customer.teamId, customer.contact].some((value) => value.toLowerCase().includes(keyword)))
      && (!issueKeyword || customer.issues.some((issue) => [issue.title, issue.description].some((value) => value.toLowerCase().includes(issueKeyword))))
      && (!featureKeyword || customer.features.some((feature) => [feature.title, feature.description].some((value) => value.toLowerCase().includes(featureKeyword))))
      && (region === "all" || customer.region === region) && (status === "all" || customer.status === status)
      && (quickFilter === "all" || customer.status === quickFilter || customer.followUpStatus === quickFilter);
  }), [customers, featureQuery, issueQuery, query, quickFilter, region, status]);
  const visibleCustomers = useMemo(() => {
    if (!sort) return filtered;
    return [...filtered].sort((left, right) => {
      const leftValue = sort.key === "monthlyFee" ? monthlyFeeValue(left.monthlyFee) : Date.parse(left.createdAt);
      const rightValue = sort.key === "monthlyFee" ? monthlyFeeValue(right.monthlyFee) : Date.parse(right.createdAt);
      if (leftValue < 0 || Number.isNaN(leftValue)) return 1;
      if (rightValue < 0 || Number.isNaN(rightValue)) return -1;
      const comparison = leftValue - rightValue;
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [filtered, sort]);
  const pageCount = Math.max(1, Math.ceil(visibleCustomers.length / pageSize));
  const pagedCustomers = visibleCustomers.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); setJumpPage("1"); }, [featureQuery, issueQuery, pageSize, query, quickFilter, region, status]);
  useEffect(() => { if (page > pageCount) { setPage(pageCount); setJumpPage(String(pageCount)); } }, [page, pageCount]);
  const summaryCards: Array<{ label: string; filter: Customer["status"] | FollowUpStatus; count: number; className: string }> = [
    { label: "待跟进", filter: "待跟进", count: customers.filter((item) => item.followUpStatus === "待跟进").length, className: "text-amber-700" },
    { label: "已跟进", filter: "已跟进", count: customers.filter((item) => item.followUpStatus === "已跟进").length, className: "text-emerald-700" },
    { label: "流失风险", filter: "流失风险", count: customers.filter((item) => item.status === "流失风险").length, className: "text-red-700" },
    { label: "已停滞", filter: "已停滞", count: customers.filter((item) => item.status === "已停滞").length, className: "text-slate-700" },
    { label: "潜力客户", filter: "潜在客户", count: customers.filter((item) => item.status === "潜在客户").length, className: "text-blue-700" },
  ];

  const toggleSort = (key: "monthlyFee" | "createdAt") => {
    setSort((current) => current?.key === key
      ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
      : { key, direction: "desc" });
  };
  const startColumnResize = (key: string, startX: number) => {
    const initialWidth = columnWidths[key];
    const onMove = (event: MouseEvent) => setColumnWidths((widths) => ({ ...widths, [key]: Math.max(72, initialWidth + event.clientX - startX) }));
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const summarize = () => {
    if (!selected) return;
    toast.info("请在扩展端打开该客户会话并点击“重新总结”，最后同步时间仅在 AI 总结完成后更新");
  };

  return <div className="h-full overflow-y-auto bg-slate-50/70 p-4 md:p-8">
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-6 flex items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">客户概览</h2><p className="mt-1 text-sm text-muted-foreground">AI 自动总结客户核心信息，帮助快速了解客户情况</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setImporting(true)}><FileSpreadsheet />批量导入</Button><Button className="bg-blue-600" onClick={() => setAdding(true)}><Plus />添加客户</Button></div></div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">{summaryCards.map((card) => <button key={card.label} type="button" aria-pressed={quickFilter === card.filter} onClick={() => setQuickFilter((current) => current === card.filter ? "all" : card.filter)} className={`rounded-xl border bg-background p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow ${quickFilter === card.filter ? "border-blue-400 ring-2 ring-blue-100" : "border-border"}`}><p className={`text-sm font-medium ${card.className}`}>{card.label}</p><p className="mt-2 text-2xl font-bold text-foreground">{card.count}</p></button>)}</div>
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_180px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="bg-background pl-9" placeholder="搜索联系人、团队 ID 或联系方式" /></div>
        <Select value={region} onValueChange={setRegion}><SelectTrigger className="w-full bg-background"><Globe2 className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部地区</SelectItem>{[...new Set(customers.map((customer) => customer.region))].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="活跃">活跃</SelectItem><SelectItem value="流失风险">流失风险</SelectItem><SelectItem value="已停滞">已停滞</SelectItem><SelectItem value="潜在客户">潜在客户</SelectItem></SelectContent></Select>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <SearchInput value={issueQuery} onChange={setIssueQuery} placeholder="按历史问题标题或内容筛选客户" />
        <SearchInput value={featureQuery} onChange={setFeatureQuery} placeholder="按功能需求标题或内容筛选客户" />
      </div>
      <Card className="overflow-hidden py-0">
        <div className="flex items-start gap-2 border-b px-5 py-4">
          <div><p className="font-semibold">客户列表</p><p className="text-xs text-muted-foreground">共 {visibleCustomers.length} 位客户</p></div>
          <Button aria-label="刷新客户列表" title="刷新客户列表" variant="ghost" size="icon-sm" disabled={loading} onClick={() => void loadCustomers(true)}><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
        </div>
        <Table className="table-fixed" style={{ width: Object.values(columnWidths).reduce((total, width) => total + width, 0) }}>
          <TableHeader className="bg-muted/40"><TableRow>
            {([
              ["name", "联系人"], ["teamId", "团队 ID"], ["contact", "联系方式"], ["region", "地区"], ["plan", "当前套餐"],
            ] as const).map(([key, label]) => <ResizableHead key={key} label={label} width={columnWidths[key]} onResize={(startX) => startColumnResize(key, startX)} />)}
            <ResizableHead label="套餐月费" width={columnWidths.monthlyFee} onResize={(startX) => startColumnResize("monthlyFee", startX)} onSort={() => toggleSort("monthlyFee")} direction={sort?.key === "monthlyFee" ? sort.direction : undefined} />
            <ResizableHead label="使用场景" width={columnWidths.scenario} onResize={(startX) => startColumnResize("scenario", startX)} />
            <ResizableHead label="状态" width={columnWidths.status} onResize={(startX) => startColumnResize("status", startX)} />
            <ResizableHead label="跟进状态" width={columnWidths.followUpStatus} onResize={(startX) => startColumnResize("followUpStatus", startX)} />
            <ResizableHead label="创建时间" width={columnWidths.createdAt} onResize={(startX) => startColumnResize("createdAt", startX)} onSort={() => toggleSort("createdAt")} direction={sort?.key === "createdAt" ? sort.direction : undefined} />
            <ResizableHead label="最后同步" width={columnWidths.updatedAt} onResize={(startX) => startColumnResize("updatedAt", startX)} />
            <ResizableHead label="操作" width={columnWidths.action} onResize={(startX) => startColumnResize("action", startX)} />
          </TableRow></TableHeader>
          <TableBody>{pagedCustomers.map((customer) => <TableRow key={customer.id} className="h-[74px] cursor-pointer" onClick={() => setSelectedId(customer.id)}>
            <TableCell className="overflow-hidden pl-5"><div className="flex min-w-0 items-center gap-3"><Avatar className="shrink-0"><AvatarFallback className="bg-blue-50 text-xs text-blue-700">{customer.initials}</AvatarFallback></Avatar><Tooltip><TooltipTrigger asChild><span className="min-w-0 truncate font-medium">{customer.name}</span></TooltipTrigger><TooltipContent className="max-w-80 select-text break-all" sideOffset={6} onClick={(event) => event.stopPropagation()}>{customer.name}</TooltipContent></Tooltip></div></TableCell>
            <TableCell className="overflow-hidden text-ellipsis font-mono text-xs">{customer.teamId}</TableCell>
            <TableCell className="overflow-hidden"><p>{customer.channel}</p><Tooltip><TooltipTrigger asChild><p className="truncate text-xs text-muted-foreground">{customer.contact}</p></TooltipTrigger><TooltipContent className="max-w-80 select-text break-all" sideOffset={6} onClick={(event) => event.stopPropagation()}>{customer.contact}</TooltipContent></Tooltip></TableCell>
            <TableCell className="overflow-hidden text-ellipsis">{customer.region}</TableCell><TableCell>{customer.plan}</TableCell><TableCell>{customer.monthlyFee}</TableCell>
            <TableCell className="overflow-hidden text-ellipsis">{customer.scenario}</TableCell><TableCell>{customer.status === "已停滞" ? <Tooltip><TooltipTrigger asChild><Badge variant="outline" className={statusStyle[customer.status]}>{customer.status}</Badge></TooltipTrigger><TooltipContent className="max-w-72 whitespace-pre-wrap">流失原因：{customer.churnReason || "暂未记录"}</TooltipContent></Tooltip> : <Badge variant="outline" className={statusStyle[customer.status]}>{customer.status}</Badge>}</TableCell>
            <TableCell><button type="button" className="rounded-full" onClick={(event) => { event.stopPropagation(); if (customer.followUpStatus === "待跟进") setFollowUpCustomerId(customer.id); }}><Badge variant="outline" className={customer.followUpStatus === "待跟进" ? "border-amber-200 bg-amber-50 text-amber-700" : customer.followUpStatus === "已跟进" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}>{customer.followUpStatus}</Badge></button></TableCell>
            <TableCell className="text-xs text-muted-foreground">{customer.createdAt}</TableCell><TableCell className="text-xs text-muted-foreground">{customer.updatedAt}</TableCell>
            <TableCell><Button variant="ghost" size="sm" className="text-blue-600">详情<ChevronRight /></Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
        {!loading && visibleCustomers.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">暂无客户总结，请在扩展端打开会话并点击“生成总结”</div> : null}
        {loading ? <div className="py-16 text-center text-sm text-muted-foreground">正在加载 AI 客户总结…</div> : null}
        {!loading && visibleCustomers.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm"><span className="text-muted-foreground">本页 {pagedCustomers.length} 条，共 {visibleCustomers.length} 条</span><div className="flex flex-wrap items-center gap-2"><Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="20">20 / 页</SelectItem><SelectItem value="50">50 / 页</SelectItem><SelectItem value="100">100 / 页</SelectItem></SelectContent></Select><Button variant="outline" size="icon-sm" disabled={page === 1} onClick={() => { const next = page - 1; setPage(next); setJumpPage(String(next)); }}><ChevronLeft /></Button><span>{page} / {pageCount}</span><Button variant="outline" size="icon-sm" disabled={page === pageCount} onClick={() => { const next = page + 1; setPage(next); setJumpPage(String(next)); }}><ChevronRight /></Button><span className="text-muted-foreground">跳至</span><Input aria-label="输入页码" className="h-8 w-16" inputMode="numeric" value={jumpPage} onChange={(event) => setJumpPage(event.target.value.replace(/\D/g, ""))} onKeyDown={(event) => { if (event.key === "Enter") { const next = Math.min(pageCount, Math.max(1, Number(jumpPage) || 1)); setPage(next); setJumpPage(String(next)); } }} /><Button variant="outline" size="sm" onClick={() => { const next = Math.min(pageCount, Math.max(1, Number(jumpPage) || 1)); setPage(next); setJumpPage(String(next)); }}>跳转</Button></div></div> : null}
      </Card>
    </div>
    {selected && <CustomerDetail customer={selected} onClose={() => setSelectedId(null)} onSummarize={summarize} onSave={(updated) => setCustomers((items) => items.map((item) => item.id === updated.id ? updated : item))} onDelete={(id) => { setCustomers((items) => items.filter((item) => item.id !== id)); setSelectedId(null); }} />}
    <AddCustomerDialog open={adding} customers={customers} onOpenChange={setAdding} onCreated={async (id) => { await loadCustomers(); setSelectedId(id); }} onExisting={(id) => { setAdding(false); setSelectedId(id); }} />
    <CustomerImportDialog open={importing} onOpenChange={setImporting} onImported={() => loadCustomers()} />
    {followUpCustomerId ? <FollowUpDialog customer={customers.find((item) => item.id === followUpCustomerId) ?? null} open onOpenChange={(open) => { if (!open) setFollowUpCustomerId(null); }} onSaved={(updated) => { setCustomers((items) => items.map((item) => item.id === updated.id ? updated : item)); setFollowUpCustomerId(null); }} /> : null}
  </div>;
}

type ImportAnalysis = { recognized: number; created: number; updated: number; errors: string[] };

function CustomerImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => Promise<void> }) {
  const [rows, setRows] = useState<CustomerImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => { setRows([]); setFileName(""); setAnalysis(null); };
  const changeOpen = (nextOpen: boolean) => { if (!nextOpen && !saving) reset(); onOpenChange(nextOpen); };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setAnalyzing(true); setAnalysis(null); setFileName(file.name);
    try {
      const parsedRows = await parseCustomerImportFile(file);
      const response = await fetch("/api/copilot/customer-summary", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerImport: parsedRows, commit: false }),
      });
      const payload = await response.json() as ImportAnalysis & { error?: string };
      if (!response.ok) throw new Error(payload.error || "表格分析失败");
      setRows(parsedRows); setAnalysis(payload);
    } catch (error: unknown) {
      reset(); toast.error(error instanceof Error ? error.message : "表格分析失败");
    } finally { setAnalyzing(false); }
  };
  const submit = async () => {
    if (!analysis?.recognized) return;
    setSaving(true);
    try {
      const response = await fetch("/api/copilot/customer-summary", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerImport: rows, commit: true }),
      });
      const payload = await response.json() as ImportAnalysis & { error?: string };
      if (!response.ok) throw new Error(payload.error || "客户导入失败");
      await onImported();
      toast.success(`导入完成：新建 ${payload.created} 条，更新 ${payload.updated} 条`);
      reset(); onOpenChange(false);
    } catch (error: unknown) { toast.error(error instanceof Error ? error.message : "客户导入失败"); } finally { setSaving(false); }
  };

  return <Dialog open={open} onOpenChange={changeOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>批量导入客户</DialogTitle><DialogDescription>系统以团队 ID 匹配客户；已有记录更新，未有记录自动创建。</DialogDescription></DialogHeader>
    <section className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-medium">导入模板</h4><p className="text-sm text-muted-foreground">请先下载模板并按示例填写。</p></div><Button variant="outline" onClick={downloadCustomerImportTemplate}><Download />下载模板</Button></div>
      <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow>{["团队ID *", "联系人", "联系方式", "客户类型", "使用场景", "用户规模", "账号规模", "创建时间", "套餐月费", "地区", "当前套餐", "客户状态"].map((header) => <TableHead key={header} className="whitespace-nowrap">{header}</TableHead>)}</TableRow></TableHeader><TableBody><TableRow>{["DIC-示例001", "张三", "zhangsan@example.com", "代理商", "跨境电商多店铺运营", "10 人", "100 个", "2026-07-31", "49.00", "中国", "Plus", "活跃"].map((value, index) => <TableCell key={`${index}-${value}`} className="whitespace-nowrap text-xs text-muted-foreground">{value}</TableCell>)}</TableRow></TableBody></Table></div>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground"><li>团队 ID 必填，且同一表格内不可重复。</li><li>已有客户仅更新非空单元格；空白字段保留原值。</li><li>客户状态可填写：活跃、流失风险、已停滞、潜在客户。</li><li>创建时间建议填写 YYYY-MM-DD，例如 2026-07-31。</li></ul>
    </section>
    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center hover:bg-muted/40"><Upload className="size-6 text-blue-600" /><span className="font-medium">{analyzing ? "正在分析表格…" : "上传 Excel 表格"}</span><span className="text-xs text-muted-foreground">支持 .xlsx、.xls 文件{fileName ? ` · ${fileName}` : ""}</span><Input className="sr-only" type="file" accept=".xlsx,.xls" disabled={analyzing || saving} onChange={(event) => void upload(event.target.files?.[0])} /></label>
    {analysis ? <section className="space-y-3"><div className="grid grid-cols-3 gap-3">{[["成功识别", analysis.recognized], ["新建客户", analysis.created], ["更新客户", analysis.updated]].map(([label, value]) => <Card key={label}><CardContent className="py-4 text-center"><p className="text-2xl font-bold text-blue-600">{value}</p><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>)}</div>{analysis.errors.length ? <div className="max-h-28 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><p className="mb-1 font-medium">以下行未识别：</p>{analysis.errors.map((error) => <p key={error}>{error}</p>)}</div> : null}</section> : null}
    <DialogFooter><Button variant="outline" disabled={saving} onClick={() => changeOpen(false)}>取消</Button><Button disabled={!analysis?.recognized || analyzing || saving} onClick={() => void submit()}>{saving ? "正在导入…" : "确认导入"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function CustomerDetail({ customer, onClose, onSummarize, onSave, onDelete }: { customer: Customer; onClose: () => void; onSummarize: () => void; onSave: (customer: Customer) => void; onDelete: (id: string) => void }) {
  const [draft, setDraft] = useState(customer);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingFeature, setEditingFeature] = useState<number | null>(null);
  const [editingIssue, setEditingIssue] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setDraft(customer), [customer]);

  const persist = async (next: Customer, message: string) => {
    const normalizedNext = { ...next, issues: newestFirst(next.issues), features: newestFirst(next.features) };
    setSaving(true);
    try {
      const response = await fetch("/api/copilot/customer-summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalChatId: customer.id,
          updates: {
            contactName: normalizedNext.name, contactMethod: normalizedNext.channel, contactDetail: normalizedNext.contact, teamId: normalizedNext.teamId, region: normalizedNext.region,
            customerType: normalizedNext.type, customerStatus: normalizedNext.status, useCase: normalizedNext.scenario, userScale: normalizedNext.users,
            accountScale: normalizedNext.accounts, currentPlan: normalizedNext.plan, monthlyFee: normalizedNext.monthlyFee, createdAt: normalizedNext.createdAt, notes: normalizedNext.note,
            issues: normalizedNext.issues.map(({ date, ...issue }) => ({ ...issue, occurredAt: date })),
            featureRequests: normalizedNext.features.map(({ date, ...feature }) => ({ ...feature, requestedAt: date })),
            competitorUsage: normalizedNext.competitorUsage, coreNeeds: normalizedNext.coreNeeds, selectionReason: normalizedNext.selectionReason, churnReason: normalizedNext.churnReason,
            followUpStatus: normalizedNext.followUpStatus, followUps: normalizedNext.followUps.map(({ date, ...followUp }) => ({ ...followUp, followedAt: date })),
          },
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "保存失败");
      setDraft(normalizedNext);
      onSave(normalizedNext);
      toast.success(message);
      return true;
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const finishProfile = async () => {
    if (!draft.name.trim()) return toast.error("联系人不能为空");
    const followUpStatus = customer.status === "活跃" && draft.status !== "活跃" && draft.followUpStatus === "无需跟进" ? "待跟进" : draft.followUpStatus;
    if (await persist({ ...draft, followUpStatus, name: draft.name.trim(), initials: draft.name.trim().slice(0, 2).toUpperCase() }, "客户信息已保存")) setEditingProfile(false);
  };
  const updateIssueStatus = (index: number, status: IssueStatus) => {
    const issues = draft.issues.map((issue, itemIndex) => itemIndex === index ? { ...issue, status } : issue);
    void persist({ ...draft, issues }, "问题状态已更新");
  };
  const deleteIssue = (index: number) => void persist({ ...draft, issues: draft.issues.filter((_, itemIndex) => itemIndex !== index) }, "历史问题已删除");
  const deleteFeature = (index: number) => void persist({ ...draft, features: draft.features.filter((_, itemIndex) => itemIndex !== index) }, "功能需求已删除");
  const finishFeature = async (index: number) => {
    if (!draft.features[index]?.title.trim()) return toast.error("需求标题不能为空");
    if (await persist(draft, "功能需求已更新")) setEditingFeature(null);
  };
  const addIssue = () => { setDraft((item) => ({ ...item, issues: [{ title: "", description: "", resolution: "", status: "未处理", date: formatInUtc8(new Date().toISOString(), false) }, ...item.issues] })); setEditingIssue(0); };
  const finishIssue = async (index: number) => {
    if (!draft.issues[index]?.title.trim()) return toast.error("问题标题不能为空");
    if (await persist(draft, "历史问题已保存")) setEditingIssue(null);
  };
  const addFeature = () => { setDraft((item) => ({ ...item, features: [{ title: "", description: "", status: "未评估", date: formatInUtc8(new Date().toISOString(), false) }, ...item.features] })); setEditingFeature(0); };
  const finishNote = async () => {
    if (await persist(draft, "备注已保存")) setEditingNote(false);
  };
  const deleteCustomer = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/copilot/customer-summary?externalChatId=${encodeURIComponent(customer.id)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "删除客户失败");
      onDelete(customer.id);
      toast.success("客户已删除");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "删除客户失败");
    } finally {
      setDeleting(false);
    }
  };

  return <div className="absolute inset-0 z-30 bg-black/25" onMouseDown={onClose}><aside role="dialog" aria-modal="true" aria-label={`${draft.name}的客户详情`} className="ml-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="shrink-0 border-b p-4 md:p-6"><div className="mb-3 flex justify-between md:mb-4"><Button variant="ghost" size="sm" onClick={onClose}><X />关闭</Button><div className="flex gap-2"><AlertDialog><AlertDialogTrigger asChild><Button variant="outline" size="sm" className="text-destructive hover:text-destructive"><Trash2 />删除客户</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除客户？</AlertDialogTitle><AlertDialogDescription>将永久删除“{draft.name}”及其客户总结、历史问题和功能需求，此操作无法撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel><AlertDialogAction disabled={deleting} className="bg-destructive text-white hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void deleteCustomer(); }}>{deleting ? "删除中…" : "确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Button size="sm" onClick={onSummarize}><RefreshCw />重新 AI 总结</Button></div></div><div className="flex min-w-0 items-center gap-3 md:gap-4"><Avatar className="size-12 shrink-0 md:size-14"><AvatarFallback className="bg-blue-50 text-blue-700">{draft.initials}</AvatarFallback></Avatar><div className="min-w-0"><h3 className="truncate text-lg font-bold md:text-xl">{draft.name}</h3><p className="mt-1 flex items-center gap-2 truncate text-sm text-muted-foreground"><MessageCircle className="size-4 shrink-0" />{draft.channel} · {draft.contact} · {draft.region}</p></div></div></header>
    <Tabs defaultValue="profile" className="min-h-0 flex-1 gap-0 overflow-hidden"><TabsList className="h-12 w-full shrink-0 justify-start overflow-x-auto rounded-none border-b bg-background px-2 md:px-6"><TabsTrigger className="flex-none" value="profile">客户信息</TabsTrigger><TabsTrigger className="flex-none" value="issues">历史问题 ({draft.issues.length})</TabsTrigger><TabsTrigger className="flex-none" value="features">功能需求 ({draft.features.length})</TabsTrigger><TabsTrigger className="flex-none" value="follow-ups">跟进记录 ({draft.followUps.length})</TabsTrigger><TabsTrigger className="flex-none" value="notes">备注</TabsTrigger></TabsList><div className="min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto bg-muted/20 p-4 md:p-6">
      <TabsContent value="profile" className="mt-0 space-y-4"><div className="flex justify-end">{editingProfile ? <Button size="sm" disabled={saving} onClick={() => void finishProfile()}><Check />完成</Button> : <Button size="sm" variant="outline" onClick={() => setEditingProfile(true)}><Pencil />编辑</Button>}</div><EditableInfoCard title="基础信息" editing={editingProfile} customer={draft} fields={[["联系人", "name"], ["联系方式", "contact"], ["渠道", "channel"], ["团队 ID", "teamId"], ["所在地区", "region"], ["客户类型", "type"], ["客户状态", "status"], ["当前套餐", "plan"], ["套餐月费", "monthlyFee"], ["创建时间", "createdAt"]]} onChange={(key, value) => setDraft((item) => ({ ...item, [key]: value }))} /><EditableInfoCard title="业务信息" editing={editingProfile} customer={draft} fields={[["使用场景", "scenario"], ["用户规模", "users"], ["账号规模", "accounts"]]} onChange={(key, value) => setDraft((item) => ({ ...item, [key]: value }))} /><EditableInfoCard title="背景信息" editing={editingProfile} customer={draft} fields={[["竞品使用情况", "competitorUsage"], ["核心需求", "coreNeeds"], ["选择原因", "selectionReason"], ["流失原因", "churnReason"]]} onChange={(key, value) => setDraft((item) => ({ ...item, [key]: value }))} /></TabsContent>
      <TabsContent value="issues" className="mt-0 space-y-4"><div className="flex justify-end"><Button size="sm" variant="outline" onClick={addIssue}><Plus />添加问题</Button></div>{draft.issues.map((issue, index) => <Card key={`issue-${index}`}><CardContent><div className="flex items-start gap-3"><div className="min-w-0 flex-1">{editingIssue === index ? <div className="space-y-3"><Input aria-label="问题标题" placeholder="问题标题" value={issue.title} onChange={(event) => setDraft((item) => ({ ...item, issues: item.issues.map((value, itemIndex) => itemIndex === index ? { ...value, title: event.target.value } : value) }))} /><Textarea aria-label="问题描述" placeholder="问题描述" value={issue.description} onChange={(event) => setDraft((item) => ({ ...item, issues: item.issues.map((value, itemIndex) => itemIndex === index ? { ...value, description: event.target.value } : value) }))} /><Input aria-label="处理记录" placeholder="处理记录" value={issue.resolution} onChange={(event) => setDraft((item) => ({ ...item, issues: item.issues.map((value, itemIndex) => itemIndex === index ? { ...value, resolution: event.target.value } : value) }))} /><Input type="date" aria-label="发生日期" value={issue.date} onChange={(event) => setDraft((item) => ({ ...item, issues: item.issues.map((value, itemIndex) => itemIndex === index ? { ...value, date: event.target.value } : value) }))} /></div> : <><h4 className="font-semibold">{issue.title}</h4><p className="mt-3 text-sm text-muted-foreground">{issue.description}</p><p className="mt-2 text-sm">处理记录：{issue.resolution}</p><p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" />{issue.date}</p></>}</div><Select disabled={saving} value={issue.status} onValueChange={(value: IssueStatus) => updateIssueStatus(index, value)}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="未处理">未处理</SelectItem><SelectItem value="处理中">处理中</SelectItem><SelectItem value="已解决">已解决</SelectItem></SelectContent></Select>{editingIssue === index ? <Button aria-label="完成编辑" variant="ghost" size="icon" disabled={saving} onClick={() => void finishIssue(index)}><Check /></Button> : <Button aria-label="编辑历史问题" variant="ghost" size="icon" onClick={() => setEditingIssue(index)}><Pencil /></Button>}<Button aria-label="删除历史问题" variant="ghost" size="icon" disabled={saving} onClick={() => deleteIssue(index)}><Trash2 className="text-destructive" /></Button></div></CardContent></Card>)}</TabsContent>
      <TabsContent value="features" className="mt-0 space-y-4"><div className="flex justify-end"><Button size="sm" variant="outline" onClick={addFeature}><Plus />添加需求</Button></div>{draft.features.map((feature, index) => <Card key={`feature-${index}`}><CardContent><div className="flex gap-3"><Sparkles className="size-5 shrink-0 text-violet-600" /><div className="min-w-0 flex-1">{editingFeature === index ? <div className="space-y-3"><Input aria-label="需求标题" value={feature.title} onChange={(event) => setDraft((item) => ({ ...item, features: item.features.map((value, itemIndex) => itemIndex === index ? { ...value, title: event.target.value } : value) }))} /><Input aria-label="需求内容" value={feature.description} onChange={(event) => setDraft((item) => ({ ...item, features: item.features.map((value, itemIndex) => itemIndex === index ? { ...value, description: event.target.value } : value) }))} /><Input type="date" aria-label="需求日期" value={feature.date} onChange={(event) => setDraft((item) => ({ ...item, features: item.features.map((value, itemIndex) => itemIndex === index ? { ...value, date: event.target.value } : value) }))} /><Select value={feature.status} onValueChange={(value: Feature["status"]) => setDraft((item) => ({ ...item, features: item.features.map((current, itemIndex) => itemIndex === index ? { ...current, status: value } : current) }))}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="未评估">未评估</SelectItem><SelectItem value="已评估">已评估</SelectItem><SelectItem value="已有可实现方案">已有可实现方案</SelectItem><SelectItem value="暂无法实现">暂无法实现</SelectItem><SelectItem value="已上线">已上线</SelectItem></SelectContent></Select></div> : <><h4 className="font-semibold">{feature.title}</h4><p className="mt-2 text-sm text-muted-foreground">{feature.description}</p><div className="mt-3 flex items-center gap-3"><Badge variant="outline">{feature.status}</Badge><span className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" />{feature.date}</span></div></>}</div><div className="flex shrink-0">{editingFeature === index ? <Button aria-label="完成编辑" variant="ghost" size="icon" disabled={saving} onClick={() => void finishFeature(index)}><Check /></Button> : <Button aria-label="编辑功能需求" variant="ghost" size="icon" onClick={() => setEditingFeature(index)}><Pencil /></Button>}<Button aria-label="删除功能需求" variant="ghost" size="icon" disabled={saving} onClick={() => deleteFeature(index)}><Trash2 className="text-destructive" /></Button></div></div></CardContent></Card>)}</TabsContent>
      <TabsContent value="follow-ups" className="mt-0 space-y-4"><Card><CardContent className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">当前跟进状态</p><p className="mt-1 font-semibold">{draft.followUpStatus}</p></div><Select disabled={saving} value={draft.followUpStatus} onValueChange={(value: FollowUpStatus) => void persist({ ...draft, followUpStatus: value }, "跟进状态已更新")}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{followUpStatuses.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></CardContent></Card><div className="flex justify-end"><FollowUpDialog customer={draft} open={false} trigger={<Button size="sm" variant="outline"><Plus />添加跟进记录</Button>} onOpenChange={() => undefined} onSaved={(updated) => { setDraft(updated); onSave(updated); }} /></div>{draft.followUps.map((followUp, index) => <Card key={`${followUp.date}-${index}`}><CardContent><div className="flex items-center justify-between gap-3"><Badge variant="outline">{followUp.type}</Badge><span className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" />{followUp.date}</span></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6">{followUp.result}</p></CardContent></Card>)}{draft.followUps.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">暂无跟进记录</p> : null}</TabsContent>
      <TabsContent value="notes" className="mt-0 space-y-4"><div className="flex justify-end">{editingNote ? <Button size="sm" disabled={saving} onClick={() => void finishNote()}><Check />保存</Button> : <Button size="sm" variant="outline" onClick={() => setEditingNote(true)}><Pencil />编辑备注</Button>}</div><Card><CardContent>{editingNote ? <Textarea aria-label="备注内容" className="min-h-32 resize-y" value={draft.note} onChange={(event) => setDraft((item) => ({ ...item, note: event.target.value }))} placeholder="输入客户备注" /> : <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{draft.note || "暂无备注"}</p>}</CardContent></Card></TabsContent>
    </div></Tabs></aside></div>;
}

const emptyCustomerForm = { contactName: "", teamId: "", contactDetail: "", region: "", customerType: "", useCase: "", userScale: "", accountScale: "", currentPlan: "", monthlyFee: "", notes: "" };

function AddCustomerDialog({ open, customers, onOpenChange, onCreated, onExisting }: { open: boolean; customers: Customer[]; onOpenChange: (open: boolean) => void; onCreated: (id: string) => Promise<void>; onExisting: (id: string) => void }) {
  const [form, setForm] = useState(emptyCustomerForm);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [saving, setSaving] = useState(false);
  const duplicate = customers.find((customer) => customer.teamId.trim().toLowerCase() === form.teamId.trim().toLowerCase() && form.teamId.trim());
  const update = (key: keyof typeof emptyCustomerForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    if (!form.contactName.trim() || !form.teamId.trim()) return toast.error("请填写联系人和团队 ID");
    if (duplicate) return onExisting(duplicate.id);
    setSaving(true);
    try {
      const response = await fetch("/api/copilot/customer-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: { ...form, contactMethod: "手动添加", customerStatus: "活跃", issues: issues.map(({ date, ...issue }) => ({ ...issue, occurredAt: date })), featureRequests: features.map(({ date, ...feature }) => ({ ...feature, requestedAt: date })) } }) });
      const payload = await response.json() as { error?: string; existingId?: string; summary?: { externalChatId?: string } };
      if (response.status === 409 && payload.existingId) return onExisting(payload.existingId);
      if (!response.ok || !payload.summary?.externalChatId) throw new Error(payload.error || "添加客户失败");
      setForm(emptyCustomerForm); setIssues([]); setFeatures([]); onOpenChange(false);
      await onCreated(payload.summary.externalChatId);
      toast.success("客户已添加");
    } catch (error: unknown) { toast.error(error instanceof Error ? error.message : "添加客户失败"); } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>添加客户</DialogTitle><DialogDescription>团队 ID 是客户的唯一归纳标识，也可同时录入历史问题和功能需求。</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
    {([["联系人 *", "contactName"], ["团队 ID *", "teamId"], ["联系方式", "contactDetail"], ["地区", "region"], ["客户类型", "customerType"], ["使用场景", "useCase"], ["用户规模", "userScale"], ["账号规模", "accountScale"], ["当前套餐", "currentPlan"], ["套餐月费", "monthlyFee"]] as Array<[string, keyof typeof emptyCustomerForm]>).map(([label, key]) => <label key={key} className="space-y-1 text-sm"><span>{label}</span><Input value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>)}
  </div>{duplicate ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">该团队 ID 已有客户记录：{duplicate.name}。<Button variant="link" className="h-auto px-1 text-amber-900" onClick={() => onExisting(duplicate.id)}>前往记录编辑</Button></div> : null}<label className="space-y-1 text-sm"><span>备注</span><Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></label>
  <section className="space-y-3"><div className="flex items-center justify-between"><h4 className="font-medium">历史问题</h4><Button size="sm" variant="outline" onClick={() => setIssues((items) => [{ title: "", description: "", resolution: "", status: "未处理", date: formatInUtc8(new Date().toISOString(), false) }, ...items])}><Plus />添加</Button></div>{issues.map((issue, index) => <Card key={index}><CardContent className="grid gap-2 sm:grid-cols-2"><Input placeholder="问题标题" value={issue.title} onChange={(event) => setIssues((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><Input placeholder="问题描述" value={issue.description} onChange={(event) => setIssues((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /><Input type="date" aria-label="问题日期" value={issue.date} onChange={(event) => setIssues((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item))} /></CardContent></Card>)}</section>
  <section className="space-y-3"><div className="flex items-center justify-between"><h4 className="font-medium">功能需求</h4><Button size="sm" variant="outline" onClick={() => setFeatures((items) => [{ title: "", description: "", status: "未评估", date: formatInUtc8(new Date().toISOString(), false) }, ...items])}><Plus />添加</Button></div>{features.map((feature, index) => <Card key={index}><CardContent className="grid gap-2 sm:grid-cols-2"><Input placeholder="需求标题" value={feature.title} onChange={(event) => setFeatures((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><Input placeholder="需求描述" value={feature.description} onChange={(event) => setFeatures((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /><Input type="date" aria-label="需求日期" value={feature.date} onChange={(event) => setFeatures((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item))} /></CardContent></Card>)}</section>
  <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={saving || Boolean(duplicate)} onClick={() => void submit()}>{saving ? "保存中…" : "添加客户"}</Button></DialogFooter></DialogContent></Dialog>;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={value} onChange={(event) => onChange(event.target.value)} className="bg-background pl-9" placeholder={placeholder} /></div>;
}

function FollowUpDialog({ customer, open, trigger, onOpenChange, onSaved }: { customer: Customer | null; open: boolean; trigger?: React.ReactNode; onOpenChange: (open: boolean) => void; onSaved: (customer: Customer) => void }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [date, setDate] = useState("");
  const [type, setType] = useState<FollowUpType>("功能回访");
  const [result, setResult] = useState("");
  const [saving, setSaving] = useState(false);
  const isOpen = trigger ? internalOpen : open;
  const changeOpen = (next: boolean) => { if (trigger) setInternalOpen(next); onOpenChange(next); if (!next) { setDate(""); setType("功能回访"); setResult(""); } };
  const submit = async () => {
    if (!customer || !date || !result.trim()) return toast.error("请完整填写跟进时间和结果");
    setSaving(true);
    try {
      const next = { ...customer, followUpStatus: "已跟进" as const, followUps: newestFirst([{ date, type, result: result.trim() }, ...customer.followUps]) };
      const response = await fetch("/api/copilot/customer-summary", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalChatId: customer.id, updates: { followUpStatus: next.followUpStatus, followUps: next.followUps.map(({ date: followedAt, ...item }) => ({ ...item, followedAt })) } }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "跟进记录保存失败");
      onSaved(next); changeOpen(false); toast.success("跟进记录已添加，状态已更新为已跟进");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "跟进记录保存失败");
    } finally { setSaving(false); }
  };
  return <Dialog open={isOpen} onOpenChange={changeOpen}>{trigger ? <span onClick={() => changeOpen(true)}>{trigger}</span> : null}<DialogContent><DialogHeader><DialogTitle>添加跟进记录</DialogTitle><DialogDescription>记录本次客户跟进，保存后跟进状态将自动变为“已跟进”。</DialogDescription></DialogHeader><div className="space-y-4"><label className="block space-y-1 text-sm"><span>跟进时间</span><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="block space-y-1 text-sm"><span>跟进类型</span><Select value={type} onValueChange={(value: FollowUpType) => setType(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{followUpTypes.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label className="block space-y-1 text-sm"><span>跟进结果</span><Textarea className="min-h-28" value={result} onChange={(event) => setResult(event.target.value)} placeholder="请输入本次跟进结果" /></label></div><DialogFooter><Button variant="outline" onClick={() => changeOpen(false)}>取消</Button><Button disabled={saving} onClick={() => void submit()}>{saving ? "保存中…" : "保存记录"}</Button></DialogFooter></DialogContent></Dialog>;
}

type EditableCustomerKey = "name" | "contact" | "channel" | "teamId" | "region" | "type" | "status" | "scenario" | "users" | "accounts" | "plan" | "monthlyFee" | "createdAt" | "competitorUsage" | "coreNeeds" | "selectionReason" | "churnReason";
function EditableInfoCard({ title, fields, customer, editing, onChange }: { title: string; fields: Array<[string, EditableCustomerKey]>; customer: Customer; editing: boolean; onChange: (key: EditableCustomerKey, value: string) => void }) {
  return <Card><CardContent><h4 className="mb-5 font-semibold">{title}</h4><div className="grid gap-5 sm:grid-cols-2">{fields.map(([label, key]) => <div key={key}><p className="mb-1 text-xs text-muted-foreground">{label}</p>{editing ? key === "status" ? <Select value={customer.status} onValueChange={(value: Customer["status"]) => onChange(key, value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="活跃">活跃</SelectItem><SelectItem value="流失风险">流失风险</SelectItem><SelectItem value="已停滞">已停滞</SelectItem><SelectItem value="潜在客户">潜在客户</SelectItem></SelectContent></Select> : <Input value={customer[key]} onChange={(event) => onChange(key, event.target.value)} /> : <p className="text-sm font-medium">{customer[key]}</p>}</div>)}</div></CardContent></Card>;
}