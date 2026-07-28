"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronRight, Globe2, MessageCircle, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

type IssueStatus = "未处理" | "处理中" | "已解决";
type Issue = { title: string; description: string; resolution: string; status: IssueStatus; date: string };
type Feature = { title: string; description: string; status: "未评估" | "已评估" | "已上线" };
type Customer = {
  id: string; name: string; initials: string; teamId: string; channel: string; contact: string;
  region: string; scenario: string; type: string; users: string; accounts: string; plan: string;
  status: "活跃" | "流失风险" | "已停滞" | "潜在客户"; updatedAt: string; note: string; issues: Issue[]; features: Feature[];
};

type SummaryPayload = Partial<Omit<Customer, "id" | "name" | "initials" | "channel" | "contact" | "scenario" | "users" | "accounts" | "type" | "issues" | "features">> & {
  externalChatId?: string; contactName?: string; contactMethod?: string; contactDetail?: string; useCase?: string; userScale?: string; accountScale?: string; customerType?: string;
  currentPlan?: string; customerStatus?: string; notes?: string;
  issues?: Array<Partial<Issue> & { occurredAt?: string }>;
  featureRequests?: Array<Partial<Feature>>;
};

const statusStyle: Record<Customer["status"], string> = {
  活跃: "border-emerald-100 bg-emerald-50 text-emerald-700", 流失风险: "border-red-100 bg-red-50 text-red-700", 已停滞: "border-slate-200 bg-slate-100 text-slate-700", 潜在客户: "border-blue-100 bg-blue-50 text-blue-700",
};

function formatDateTime(value: string): string {
  if (!value || value === "—") return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : value;
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
  const [adding, setAdding] = useState(false);
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
            users: record.userScale || "未知", accounts: record.accountScale || "未知", plan: record.currentPlan || "未知",
            status, updatedAt: formatDateTime(record.updatedAt || "—"), note: record.notes || "",
            issues: (record.issues || []).map((issue) => ({ title: issue.title || "未命名问题", description: issue.description || "", resolution: issue.resolution || "", status: issue.status === "已解决" || issue.status === "处理中" ? issue.status : "未处理", date: issue.occurredAt || issue.date || "" })),
            features: (record.featureRequests || []).map((feature) => ({ title: feature.title || "未命名需求", description: feature.description || "", status: feature.status === "已评估" || feature.status === "已上线" ? feature.status : "未评估" })),
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
      && (region === "all" || customer.region === region) && (status === "all" || customer.status === status);
  }), [customers, featureQuery, issueQuery, query, region, status]);

  const summarize = () => {
    if (!selected) return;
    toast.info("请在扩展端打开该客户会话并点击“重新总结”，最后同步时间仅在 AI 总结完成后更新");
  };

  return <div className="h-full overflow-y-auto bg-slate-50/70 p-4 md:p-8">
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-6 flex items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">客户概览</h2><p className="mt-1 text-sm text-muted-foreground">AI 自动总结客户核心信息，帮助快速了解客户情况</p></div><Button className="bg-blue-600" onClick={() => setAdding(true)}><Plus />添加客户</Button></div>
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_180px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="bg-background pl-9" placeholder="搜索联系人、团队 ID 或联系方式" /></div>
        <Select value={region} onValueChange={setRegion}><SelectTrigger className="w-full bg-background"><Globe2 className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部地区</SelectItem>{[...new Set(customers.map((customer) => customer.region))].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="活跃">活跃</SelectItem><SelectItem value="流失风险">流失风险</SelectItem><SelectItem value="已停滞">已停滞</SelectItem><SelectItem value="潜在客户">潜在客户</SelectItem></SelectContent></Select>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <SearchInput value={issueQuery} onChange={setIssueQuery} placeholder="按历史问题标题或内容筛选客户" />
        <SearchInput value={featureQuery} onChange={setFeatureQuery} placeholder="按功能需求标题或内容筛选客户" />
      </div>
      <Card className="overflow-hidden py-0"><div className="flex items-start gap-2 border-b px-5 py-4"><div><p className="font-semibold">客户列表</p><p className="text-xs text-muted-foreground">共 {filtered.length} 位客户</p></div><Button aria-label="刷新客户列表" title="刷新客户列表" variant="ghost" size="icon-sm" disabled={loading} onClick={() => void loadCustomers(true)}><RefreshCw className={loading ? "animate-spin" : ""} /></Button></div><Table><TableHeader className="bg-muted/40"><TableRow><TableHead className="w-32 pl-5">联系人</TableHead><TableHead>团队 ID</TableHead><TableHead>联系方式</TableHead><TableHead>地区</TableHead><TableHead>当前套餐</TableHead><TableHead>使用场景</TableHead><TableHead>状态</TableHead><TableHead>最后同步</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((customer) => <TableRow key={customer.id} className="h-[74px] cursor-pointer" onClick={() => setSelectedId(customer.id)}><TableCell className="w-32 max-w-32 pl-5"><div className="flex min-w-0 items-center gap-3"><Avatar className="shrink-0"><AvatarFallback className="bg-blue-50 text-xs text-blue-700">{customer.initials}</AvatarFallback></Avatar><Tooltip><TooltipTrigger asChild><span className="min-w-0 truncate font-medium">{customer.name}</span></TooltipTrigger><TooltipContent className="max-w-80 select-text break-all" sideOffset={6} onClick={(event) => event.stopPropagation()}>{customer.name}</TooltipContent></Tooltip></div></TableCell><TableCell className="font-mono text-xs">{customer.teamId}</TableCell><TableCell className="max-w-40"><p>{customer.channel}</p><Tooltip><TooltipTrigger asChild><p className="truncate text-xs text-muted-foreground">{customer.contact}</p></TooltipTrigger><TooltipContent className="max-w-80 select-text break-all" sideOffset={6} onClick={(event) => event.stopPropagation()}>{customer.contact}</TooltipContent></Tooltip></TableCell><TableCell>{customer.region}</TableCell><TableCell>{customer.plan}</TableCell><TableCell className="max-w-56 truncate">{customer.scenario}</TableCell><TableCell><Badge variant="outline" className={statusStyle[customer.status]}>{customer.status}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{customer.updatedAt}</TableCell><TableCell><Button variant="ghost" size="sm" className="text-blue-600">详情<ChevronRight /></Button></TableCell></TableRow>)}</TableBody></Table>{!loading && filtered.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">暂无客户总结，请在扩展端打开会话并点击“生成总结”</div> : null}{loading ? <div className="py-16 text-center text-sm text-muted-foreground">正在加载 AI 客户总结…</div> : null}</Card>
    </div>
    {selected && <CustomerDetail customer={selected} onClose={() => setSelectedId(null)} onSummarize={summarize} onSave={(updated) => setCustomers((items) => items.map((item) => item.id === updated.id ? updated : item))} />}
    <AddCustomerDialog open={adding} customers={customers} onOpenChange={setAdding} onCreated={async (id) => { await loadCustomers(); setSelectedId(id); }} onExisting={(id) => { setAdding(false); setSelectedId(id); }} />
  </div>;
}

function CustomerDetail({ customer, onClose, onSummarize, onSave }: { customer: Customer; onClose: () => void; onSummarize: () => void; onSave: (customer: Customer) => void }) {
  const [draft, setDraft] = useState(customer);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingFeature, setEditingFeature] = useState<number | null>(null);
  const [editingIssue, setEditingIssue] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(customer), [customer]);

  const persist = async (next: Customer, message: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/copilot/customer-summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalChatId: customer.id,
          updates: {
            contactName: next.name, contactMethod: next.channel, contactDetail: next.contact, teamId: next.teamId, region: next.region,
            customerType: next.type, customerStatus: next.status, useCase: next.scenario, userScale: next.users,
            accountScale: next.accounts, currentPlan: next.plan, notes: next.note,
            issues: next.issues.map(({ date, ...issue }) => ({ ...issue, occurredAt: date })),
            featureRequests: next.features,
          },
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "保存失败");
      setDraft(next);
      onSave(next);
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
    if (await persist({ ...draft, name: draft.name.trim(), initials: draft.name.trim().slice(0, 2).toUpperCase() }, "客户信息已保存")) setEditingProfile(false);
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
  const addIssue = () => { setDraft((item) => ({ ...item, issues: [...item.issues, { title: "", description: "", resolution: "", status: "未处理", date: "" }] })); setEditingIssue(draft.issues.length); };
  const finishIssue = async (index: number) => {
    if (!draft.issues[index]?.title.trim()) return toast.error("问题标题不能为空");
    if (await persist(draft, "历史问题已保存")) setEditingIssue(null);
  };
  const addFeature = () => { setDraft((item) => ({ ...item, features: [...item.features, { title: "", description: "", status: "未评估" }] })); setEditingFeature(draft.features.length); };
  const finishNote = async () => {
    if (await persist(draft, "备注已保存")) setEditingNote(false);
  };

  return <div className="absolute inset-0 z-30 bg-black/25" onMouseDown={onClose}><aside role="dialog" aria-modal="true" aria-label={`${draft.name}的客户详情`} className="ml-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="shrink-0 border-b p-4 md:p-6"><div className="mb-3 flex justify-between md:mb-4"><Button variant="ghost" size="sm" onClick={onClose}><X />关闭</Button><Button size="sm" onClick={onSummarize}><RefreshCw />重新 AI 总结</Button></div><div className="flex min-w-0 items-center gap-3 md:gap-4"><Avatar className="size-12 shrink-0 md:size-14"><AvatarFallback className="bg-blue-50 text-blue-700">{draft.initials}</AvatarFallback></Avatar><div className="min-w-0"><h3 className="truncate text-lg font-bold md:text-xl">{draft.name}</h3><p className="mt-1 flex items-center gap-2 truncate text-sm text-muted-foreground"><MessageCircle className="size-4 shrink-0" />{draft.channel} · {draft.contact} · {draft.region}</p></div></div></header>
    <Tabs defaultValue="profile" className="min-h-0 flex-1 gap-0 overflow-hidden"><TabsList className="h-12 w-full shrink-0 justify-start overflow-x-auto rounded-none border-b bg-background px-2 md:px-6"><TabsTrigger className="flex-none" value="profile">客户信息</TabsTrigger><TabsTrigger className="flex-none" value="issues">历史问题 ({draft.issues.length})</TabsTrigger><TabsTrigger className="flex-none" value="features">功能需求 ({draft.features.length})</TabsTrigger><TabsTrigger className="flex-none" value="notes">备注</TabsTrigger></TabsList><div className="min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto bg-muted/20 p-4 md:p-6">
      <TabsContent value="profile" className="mt-0 space-y-4"><div className="flex justify-end">{editingProfile ? <Button size="sm" disabled={saving} onClick={() => void finishProfile()}><Check />完成</Button> : <Button size="sm" variant="outline" onClick={() => setEditingProfile(true)}><Pencil />编辑</Button>}</div><EditableInfoCard title="基础信息" editing={editingProfile} customer={draft} fields={[["联系人", "name"], ["联系方式", "contact"], ["渠道", "channel"], ["团队 ID", "teamId"], ["所在地区", "region"], ["客户类型", "type"], ["客户状态", "status"]]} onChange={(key, value) => setDraft((item) => ({ ...item, [key]: value }))} /><EditableInfoCard title="业务信息" editing={editingProfile} customer={draft} fields={[["使用场景", "scenario"], ["用户规模", "users"], ["账号规模", "accounts"], ["当前套餐", "plan"]]} onChange={(key, value) => setDraft((item) => ({ ...item, [key]: value }))} /></TabsContent>
      <TabsContent value="issues" className="mt-0 space-y-4"><div className="flex justify-end"><Button size="sm" variant="outline" onClick={addIssue}><Plus />添加问题</Button></div>{draft.issues.map((issue, index) => <Card key={`${issue.title}-${index}`}><CardContent><div className="flex items-start gap-3"><div className="min-w-0 flex-1">{editingIssue === index ? <div className="space-y-3"><Input aria-label="问题标题" placeholder="问题标题" value={issue.title} onChange={(event) => setDraft((item) => ({ ...item, issues: item.issues.map((value, itemIndex) => itemIndex === index ? { ...value, title: event.target.value } : value) }))} /><Textarea aria-label="问题描述" placeholder="问题描述" value={issue.description} onChange={(event) => setDraft((item) => ({ ...item, issues: item.issues.map((value, itemIndex) => itemIndex === index ? { ...value, description: event.target.value } : value) }))} /><Input aria-label="处理记录" placeholder="处理记录" value={issue.resolution} onChange={(event) => setDraft((item) => ({ ...item, issues: item.issues.map((value, itemIndex) => itemIndex === index ? { ...value, resolution: event.target.value } : value) }))} /><Input aria-label="发生时间" placeholder="发生时间" value={issue.date} onChange={(event) => setDraft((item) => ({ ...item, issues: item.issues.map((value, itemIndex) => itemIndex === index ? { ...value, date: event.target.value } : value) }))} /></div> : <><h4 className="font-semibold">{issue.title}</h4><p className="mt-3 text-sm text-muted-foreground">{issue.description}</p><p className="mt-2 text-sm">处理记录：{issue.resolution}</p><p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" />{issue.date}</p></>}</div><Select disabled={saving} value={issue.status} onValueChange={(value: IssueStatus) => updateIssueStatus(index, value)}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="未处理">未处理</SelectItem><SelectItem value="处理中">处理中</SelectItem><SelectItem value="已解决">已解决</SelectItem></SelectContent></Select>{editingIssue === index ? <Button aria-label="完成编辑" variant="ghost" size="icon" disabled={saving} onClick={() => void finishIssue(index)}><Check /></Button> : <Button aria-label="编辑历史问题" variant="ghost" size="icon" onClick={() => setEditingIssue(index)}><Pencil /></Button>}<Button aria-label="删除历史问题" variant="ghost" size="icon" disabled={saving} onClick={() => deleteIssue(index)}><Trash2 className="text-destructive" /></Button></div></CardContent></Card>)}</TabsContent>
      <TabsContent value="features" className="mt-0 space-y-4"><div className="flex justify-end"><Button size="sm" variant="outline" onClick={addFeature}><Plus />添加需求</Button></div>{draft.features.map((feature, index) => <Card key={`${feature.title}-${index}`}><CardContent><div className="flex gap-3"><Sparkles className="size-5 shrink-0 text-violet-600" /><div className="min-w-0 flex-1">{editingFeature === index ? <div className="space-y-3"><Input aria-label="需求标题" value={feature.title} onChange={(event) => setDraft((item) => ({ ...item, features: item.features.map((value, itemIndex) => itemIndex === index ? { ...value, title: event.target.value } : value) }))} /><Input aria-label="需求内容" value={feature.description} onChange={(event) => setDraft((item) => ({ ...item, features: item.features.map((value, itemIndex) => itemIndex === index ? { ...value, description: event.target.value } : value) }))} /><Select value={feature.status} onValueChange={(value: Feature["status"]) => setDraft((item) => ({ ...item, features: item.features.map((current, itemIndex) => itemIndex === index ? { ...current, status: value } : current) }))}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="未评估">未评估</SelectItem><SelectItem value="已评估">已评估</SelectItem><SelectItem value="已上线">已上线</SelectItem></SelectContent></Select></div> : <><h4 className="font-semibold">{feature.title}</h4><p className="mt-2 text-sm text-muted-foreground">{feature.description}</p><Badge className="mt-3" variant="outline">{feature.status}</Badge></>}</div><div className="flex shrink-0">{editingFeature === index ? <Button aria-label="完成编辑" variant="ghost" size="icon" disabled={saving} onClick={() => void finishFeature(index)}><Check /></Button> : <Button aria-label="编辑功能需求" variant="ghost" size="icon" onClick={() => setEditingFeature(index)}><Pencil /></Button>}<Button aria-label="删除功能需求" variant="ghost" size="icon" disabled={saving} onClick={() => deleteFeature(index)}><Trash2 className="text-destructive" /></Button></div></div></CardContent></Card>)}</TabsContent>
      <TabsContent value="notes" className="mt-0 space-y-4"><div className="flex justify-end">{editingNote ? <Button size="sm" disabled={saving} onClick={() => void finishNote()}><Check />保存</Button> : <Button size="sm" variant="outline" onClick={() => setEditingNote(true)}><Pencil />编辑备注</Button>}</div><Card><CardContent>{editingNote ? <Textarea aria-label="备注内容" className="min-h-32 resize-y" value={draft.note} onChange={(event) => setDraft((item) => ({ ...item, note: event.target.value }))} placeholder="输入客户备注" /> : <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{draft.note || "暂无备注"}</p>}</CardContent></Card></TabsContent>
    </div></Tabs></aside></div>;
}

const emptyCustomerForm = { contactName: "", teamId: "", contactDetail: "", region: "", customerType: "", useCase: "", userScale: "", accountScale: "", currentPlan: "", notes: "" };

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
      const response = await fetch("/api/copilot/customer-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: { ...form, contactMethod: "手动添加", customerStatus: "活跃", issues: issues.map(({ date, ...issue }) => ({ ...issue, occurredAt: date })), featureRequests: features } }) });
      const payload = await response.json() as { error?: string; existingId?: string; summary?: { externalChatId?: string } };
      if (response.status === 409 && payload.existingId) return onExisting(payload.existingId);
      if (!response.ok || !payload.summary?.externalChatId) throw new Error(payload.error || "添加客户失败");
      setForm(emptyCustomerForm); setIssues([]); setFeatures([]); onOpenChange(false);
      await onCreated(payload.summary.externalChatId);
      toast.success("客户已添加");
    } catch (error: unknown) { toast.error(error instanceof Error ? error.message : "添加客户失败"); } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>添加客户</DialogTitle><DialogDescription>团队 ID 是客户的唯一归纳标识，也可同时录入历史问题和功能需求。</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
    {([["联系人 *", "contactName"], ["团队 ID *", "teamId"], ["联系方式", "contactDetail"], ["地区", "region"], ["客户类型", "customerType"], ["使用场景", "useCase"], ["用户规模", "userScale"], ["账号规模", "accountScale"], ["当前套餐", "currentPlan"]] as Array<[string, keyof typeof emptyCustomerForm]>).map(([label, key]) => <label key={key} className="space-y-1 text-sm"><span>{label}</span><Input value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>)}
  </div>{duplicate ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">该团队 ID 已有客户记录：{duplicate.name}。<Button variant="link" className="h-auto px-1 text-amber-900" onClick={() => onExisting(duplicate.id)}>前往记录编辑</Button></div> : null}<label className="space-y-1 text-sm"><span>备注</span><Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></label>
  <section className="space-y-3"><div className="flex items-center justify-between"><h4 className="font-medium">历史问题</h4><Button size="sm" variant="outline" onClick={() => setIssues((items) => [...items, { title: "", description: "", resolution: "", status: "未处理", date: "" }])}><Plus />添加</Button></div>{issues.map((issue, index) => <Card key={index}><CardContent className="grid gap-2 sm:grid-cols-2"><Input placeholder="问题标题" value={issue.title} onChange={(event) => setIssues((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><Input placeholder="问题描述" value={issue.description} onChange={(event) => setIssues((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /></CardContent></Card>)}</section>
  <section className="space-y-3"><div className="flex items-center justify-between"><h4 className="font-medium">功能需求</h4><Button size="sm" variant="outline" onClick={() => setFeatures((items) => [...items, { title: "", description: "", status: "未评估" }])}><Plus />添加</Button></div>{features.map((feature, index) => <Card key={index}><CardContent className="grid gap-2 sm:grid-cols-2"><Input placeholder="需求标题" value={feature.title} onChange={(event) => setFeatures((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><Input placeholder="需求描述" value={feature.description} onChange={(event) => setFeatures((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /></CardContent></Card>)}</section>
  <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={saving || Boolean(duplicate)} onClick={() => void submit()}>{saving ? "保存中…" : "添加客户"}</Button></DialogFooter></DialogContent></Dialog>;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={value} onChange={(event) => onChange(event.target.value)} className="bg-background pl-9" placeholder={placeholder} /></div>;
}

type EditableCustomerKey = "name" | "contact" | "channel" | "teamId" | "region" | "type" | "status" | "scenario" | "users" | "accounts" | "plan";
function EditableInfoCard({ title, fields, customer, editing, onChange }: { title: string; fields: Array<[string, EditableCustomerKey]>; customer: Customer; editing: boolean; onChange: (key: EditableCustomerKey, value: string) => void }) {
  return <Card><CardContent><h4 className="mb-5 font-semibold">{title}</h4><div className="grid gap-5 sm:grid-cols-2">{fields.map(([label, key]) => <div key={key}><p className="mb-1 text-xs text-muted-foreground">{label}</p>{editing ? key === "status" ? <Select value={customer.status} onValueChange={(value: Customer["status"]) => onChange(key, value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="活跃">活跃</SelectItem><SelectItem value="流失风险">流失风险</SelectItem><SelectItem value="已停滞">已停滞</SelectItem><SelectItem value="潜在客户">潜在客户</SelectItem></SelectContent></Select> : <Input value={customer[key]} onChange={(event) => onChange(key, event.target.value)} /> : <p className="text-sm font-medium">{customer[key]}</p>}</div>)}</div></CardContent></Card>;
}