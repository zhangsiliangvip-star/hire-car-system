import type { AuditLog, LastOperation } from "@/lib/audit";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type AuditedTable<Row> = Table<Row & { last_operation: LastOperation | null }>;

export type Database = {
  public: {
    Tables: {
      audit_logs: Table<AuditLog>;
      regions: Table<{
        id: string;
        name: string;
        created_at: string;
      }>;
      profiles: Table<{
        id: string;
        email: string;
        full_name: string;
        company: string;
        position: string;
        region_id: string;
        role: "admin" | "user";
        email_confirmed: boolean;
        created_at: string;
      }>;
      orders: AuditedTable<{
        id: string;
        region_id: string;
        import_batch_id: string | null;
        import_batch_index: number | null;
        vehicle: string;
        vehicle_plate: string;
        date: string;
        end_date: string;
        off_dates: string[];
        customer: string;
        phone: string;
        pickup: string;
        destination: string;
        time: string;
        status: "仮予約" | "予約確定" | "運行中" | "完了" | "キャンセル";
        notes: string;
        driver: string;
        order_source: string;
        company: string;
        sales_rep: string;
        order_price: number;
        accounting_status: "未完成" | "完成核算";
        invoice_status: "未完成" | "已完成";
        invoice_sent_date: string | null;
        deposit_method: "" | "口座入金" | "现金入金";
        deposit_date: string | null;
        accounting_assignee: string;
        finance_note: string;
        finance_by_date: Record<string, Record<string, string | number>>;
      }>;
      drivers: AuditedTable<{
        id: string;
        region_id: string;
        name: string;
        phone: string;
        wechat: string;
        whatsapp: string;
        license_expiry: string | null;
      }>;
      vehicles: AuditedTable<{
        id: string;
        region_id: string;
        name: string;
        plate: string;
        default_parking_fee: number;
        default_insurance_fee: number;
        owner_company: string;
        seats: string;
        fuel_type: string;
        inspection_expiry: string | null;
        liability_expiry: string | null;
        notes: string;
        status: "运营中" | "停运中";
        calendar_order: number | null;
      }>;
      vehicle_monthly_finances: AuditedTable<{
        id: string;
        region_id: string;
        vehicle_id: string;
        month: string;
        parking_fee: number;
        insurance_fee: number;
        inspection_fee: number;
        repair_fee: number;
        supplies: { description: string; amount: number }[];
        start_odometer: number | null;
        end_odometer: number | null;
      }>;
      balance_expense_items: AuditedTable<{
        id: string;
        kind: "expense" | "income";
        region_id: string;
        company_name: string;
        name: string;
        monthly_amounts: Record<string, number>;
      }>;
      order_sources: AuditedTable<{
        id: string;
        region_id: string;
        company_name: string;
        short_name?: string;
        contact_name: string;
        contact_info: string;
        address: string;
        color: string;
      }>;
      companies: AuditedTable<{
        id: string;
        region_id: string;
        name: string;
        operations_manager: string;
        maintenance_manager: string;
        phone: string;
        roll_call_address: string;
        garage_address: string;
        bank_account: string;
        tax_registration_number: string;
        seal_image: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      allocate_invoice_number: {
        Args: { p_order_id: string; p_company_id: string };
        Returns: string;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_region_id: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
