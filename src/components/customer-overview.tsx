"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Globe2, MessageCircle, MoreHorizontal, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type Issue = { title: string; description: string; resolution: string; status: "已解决" | "处理中" | "待跟进"; date: string };
type Feature = { title: string; description: string; priority: "高" | "中" | "低"; status: "未评估" | "开发中" | "已完成" };
type Customer = {
  id: string; name: string; initials: string; teamId: string; channel: string; contact: string;
  region: string; scenario: string; type: string; users: string; accounts: string; plan: string;
  status: "活跃" | "跟进中" | "潜在客户"; updatedAt: string; note: string; issues: Issue[]; features: Feature[];
};

type SummaryPayload = Partial<Omit<Customer, "id" | "name" | "initials" | "channel" | "contact" | "scenario" | "users" | "accounts" | "type" | "issues" | "features">> & {
  externalChatId?: string; contactName?: string; contactMethod?: string; useCase?: string; userScale?: string; accountScale?: string; customerType?: string;
  currentPlan?: string; customerStatus?: string; notes?: string;
  issues?: Array<Partial<Issue> & { occurredAt?: string }>;
  featureRequests?: Array<Partial<Feature>>;
};

const statusStyle: Record<Customer["status"], string> = {
  活跃: "border-emerald-100 bg-emerald-50 text-emerald-700", 跟进中: "border-amber-100 bg-amber-50 text-amber-700", 潜在客户: "border-blue-100 bg-blue-50 text-blue-700",
};

export function CustomerOverview() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState("all");
  const selected = customers.find((customer) => customer.id === selectedId) ?? null;

  useEffect(() => {
    void fetch("/api/copilot/customer-summary", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("客户数据加载失败");
        return await response.json() as { customers?: SummaryPayload[] };
      })
      .then(({ customers: records = [] }) => {
        const normalized = records.flatMap((record): Customer[] => {
          if (!record.externalChatId || !record.contactName) return [];
          const status: Customer["status"] = record.customerStatus === "跟进中" || record.customerStatus === "潜在客户" ? record.customerStatus : "活跃";
          return [{
            id: record.externalChatId, name: record.contactName, initials: record.contactName.slice(0, 2).toUpperCase(),
            teamId: record.teamId || "—", channel: record.contactMethod || "WhatsApp", contact: record.contactName,
            region: record.region || "未知", scenario: record.useCase || "待 AI 补充", type: record.customerType || "未分类",
            users: record.userScale || "未知", accounts: record.accountScale || "未知", plan: record.currentPlan || "未知",
            status, updatedAt: record.updatedAt || "—", note: record.notes || "暂无备注",
            issues: (record.issues || []).map((issue) => ({ title: issue.title || "未命名问题", description: issue.description || "", resolution: issue.resolution || "", status: issue.status === "已解决" || issue.status === "处理中" ? issue.status : "待跟进", date: issue.occurredAt || issue.date || "" })),
            features: (record.featureRequests || []).map((feature) => ({ title: feature.title || "未命名需求", description: feature.description || "", priority: feature.priority === "高" || feature.priority === "低" ? feature.priority : "中", status: feature.status === "开发中" || feature.status === "已完成" ? feature.status : "未评估" })),
          }];
        });
        setCustomers(normalized);
        const deepLinkedId = new URLSearchParams(window.location.search).get("customer");
        if (deepLinkedId && normalized.some((customer) => customer.id === deepLinkedId)) setSelectedId(deepLinkedId);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "客户数据加载失败"))
      .finally(() => setLoading(false));
  }, []);
  const filtered = useMemo(() => customers.filter((customer) => {
    const keyword = query.trim().toLowerCase();
    return (!keyword || [customer.name, customer.teamId, customer.contact].some((value) => value.toLowerCase().includes(keyword)))
      && (region === "all" || customer.region === region) && (status === "all" || customer.status === status);
  }), [customers, query, region, status]);

  const summarize = () => {
    if (!selected) return;
    setCustomers((items) => items.map((item) => item.id === selected.id ? { ...item, updatedAt: "刚刚" } : item));
    toast.success("AI 已开始重新分析该客户的聊天记录");
  };

  return <div className="h-full overflow-y-auto bg-slate-50/70 p-4 md:p-8">
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-6 flex items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">客户概览</h2><p className="mt-1 text-sm text-muted-foreground">AI 自动总结客户核心信息，帮助快速了解客户情况</p></div><Button className="bg-blue-600"><Plus />添加客户</Button></div>
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_180px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="bg-background pl-9" placeholder="搜索联系人、团队 ID 或联系方式" /></div>
        <Select value={region} onValueChange={setRegion}><SelectTrigger className="w-full bg-background"><Globe2 className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部地区</SelectItem>{[...new Set(customers.map((customer) => customer.region))].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="活跃">活跃</SelectItem><SelectItem value="跟进中">跟进中</SelectItem><SelectItem value="潜在客户">潜在客户</SelectItem></SelectContent></Select>
      </div>
      <Card className="overflow-hidden py-0"><div className="border-b px-5 py-4"><p className="font-semibold">客户列表</p><p className="text-xs text-muted-foreground">共 {filtered.length} 位客户</p></div><Table><TableHeader className="bg-muted/40"><TableRow><TableHead className="pl-5">联系人</TableHead><TableHead>团队 ID</TableHead><TableHead>联系方式</TableHead><TableHead>地区</TableHead><TableHead>使用场景</TableHead><TableHead>状态</TableHead><TableHead>最后同步</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((customer) => <TableRow key={customer.id} className="h-[74px] cursor-pointer" onClick={() => setSelectedId(customer.id)}><TableCell className="pl-5"><div className="flex items-center gap-3"><Avatar><AvatarFallback className="bg-blue-50 text-xs text-blue-700">{customer.initials}</AvatarFallback></Avatar><span className="font-medium">{customer.name}</span></div></TableCell><TableCell className="font-mono text-xs">{customer.teamId}</TableCell><TableCell><p>{customer.channel}</p><p className="text-xs text-muted-foreground">{customer.contact}</p></TableCell><TableCell>{customer.region}</TableCell><TableCell className="max-w-56 truncate">{customer.scenario}</TableCell><TableCell><Badge variant="outline" className={statusStyle[customer.status]}>{customer.status}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{customer.updatedAt}</TableCell><TableCell><Button variant="ghost" size="sm" className="text-blue-600">详情<ChevronRight /></Button></TableCell></TableRow>)}</TableBody></Table>{!loading && filtered.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">暂无客户总结，请在扩展端打开会话并点击“生成总结”</div> : null}{loading ? <div className="py-16 text-center text-sm text-muted-foreground">正在加载 AI 客户总结…</div> : null}</Card>
    </div>
    {selected && <CustomerDetail customer={selected} onClose={() => setSelectedId(null)} onSummarize={summarize} />}
  </div>;
}

function CustomerDetail({ customer, onClose, onSummarize }: { customer: Customer; onClose: () => void; onSummarize: () => void }) {
  return <div className="absolute inset-0 z-30 bg-black/25" onMouseDown={onClose}><aside role="dialog" aria-modal="true" aria-label={`${customer.name}的客户详情`} className="ml-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="shrink-0 border-b p-4 md:p-6"><div className="mb-3 flex justify-between md:mb-4"><Button variant="ghost" size="sm" onClick={onClose}><X />关闭</Button><Button size="sm" onClick={onSummarize}><RefreshCw />重新 AI 总结</Button></div><div className="flex min-w-0 items-center gap-3 md:gap-4"><Avatar className="size-12 shrink-0 md:size-14"><AvatarFallback className="bg-blue-50 text-blue-700">{customer.initials}</AvatarFallback></Avatar><div className="min-w-0"><h3 className="truncate text-lg font-bold md:text-xl">{customer.name}</h3><p className="mt-1 flex items-center gap-2 truncate text-sm text-muted-foreground"><MessageCircle className="size-4 shrink-0" />{customer.channel} · {customer.contact} · {customer.region}</p></div></div></header>
    <Tabs defaultValue="profile" className="min-h-0 flex-1 gap-0 overflow-hidden"><TabsList className="h-12 w-full shrink-0 justify-start overflow-x-auto rounded-none border-b bg-background px-2 md:px-6"><TabsTrigger className="flex-none" value="profile">客户信息</TabsTrigger><TabsTrigger className="flex-none" value="issues">历史问题 ({customer.issues.length})</TabsTrigger><TabsTrigger className="flex-none" value="features">功能需求 ({customer.features.length})</TabsTrigger><TabsTrigger className="flex-none" value="notes">备注</TabsTrigger></TabsList><div className="min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto bg-muted/20 p-4 md:p-6">
      <TabsContent value="profile" className="mt-0 space-y-4"><InfoCard title="基础信息" items={[["联系人", customer.name], ["联系方式", `${customer.channel} · ${customer.contact}`], ["团队 ID", customer.teamId], ["所在地区", customer.region], ["客户类型", customer.type], ["客户状态", customer.status]]} /><InfoCard title="业务信息" items={[["使用场景", customer.scenario], ["用户规模", customer.users], ["账号规模", customer.accounts], ["当前套餐", customer.plan]]} /></TabsContent>
      <TabsContent value="issues" className="mt-0 space-y-4">{customer.issues.map((issue) => <Card key={issue.title}><CardContent><div className="flex justify-between"><h4 className="font-semibold">{issue.title}</h4><Badge variant="outline">{issue.status}</Badge></div><p className="mt-3 text-sm text-muted-foreground">{issue.description}</p><p className="mt-2 text-sm">处理记录：{issue.resolution}</p><p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" />{issue.date}</p></CardContent></Card>)}</TabsContent>
      <TabsContent value="features" className="mt-0 space-y-4">{customer.features.map((feature) => <Card key={feature.title}><CardContent><div className="flex gap-3"><Sparkles className="size-5 text-violet-600" /><div><h4 className="font-semibold">{feature.title}</h4><p className="mt-2 text-sm text-muted-foreground">{feature.description}</p><div className="mt-3 flex gap-2"><Badge variant="outline">优先级：{feature.priority}</Badge><Badge variant="outline">{feature.status}</Badge></div></div><Button variant="ghost" size="icon" className="ml-auto"><MoreHorizontal /></Button></div></CardContent></Card>)}</TabsContent>
      <TabsContent value="notes" className="mt-0"><Card><CardContent><p className="text-sm leading-7">{customer.note}</p></CardContent></Card></TabsContent>
    </div></Tabs></aside></div>;
}

function InfoCard({ title, items }: { title: string; items: string[][] }) {
  return <Card><CardContent><h4 className="mb-5 font-semibold">{title}</h4><div className="grid gap-5 sm:grid-cols-2">{items.map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>)}</div></CardContent></Card>;
}