import { pgTable, serial, timestamp, jsonb, varchar, index, integer } from "drizzle-orm/pg-core"

export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 知识库配置表
export const knowledgeConfigs = pgTable(
  "knowledge_configs",
  {
    id: serial().primaryKey(),
    config_key: varchar("config_key", { length: 50 }).notNull().unique(),
    knowledge_data: jsonb("knowledge_data").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_configs_key_idx").on(table.config_key),
  ]
);

// 系统配置表（存储 Prompt 和 API 配置）
export const systemConfigs = pgTable(
  "system_configs",
  {
    id: serial().primaryKey(),
    config_key: varchar("config_key", { length: 50 }).notNull().unique(),
    config_value: jsonb("config_value").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index("system_configs_key_idx").on(table.config_key),
  ]
);

export const customerSummaries = pgTable(
  "customer_summaries",
  {
    id: serial().primaryKey(),
    external_chat_id: varchar("external_chat_id", { length: 128 }).notNull().unique(),
    platform: varchar("platform", { length: 32 }).notNull(),
    contact_name: varchar("contact_name", { length: 255 }).notNull(),
    summary_data: jsonb("summary_data").notNull(),
    source_message_hash: varchar("source_message_hash", { length: 128 }).notNull(),
    message_count: integer("message_count").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => [index("customer_summaries_updated_idx").on(table.updated_at)],
);