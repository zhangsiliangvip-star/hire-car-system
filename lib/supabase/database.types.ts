import type { AuditLog, LastOperation } from "@/lib/audit";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

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
        account_type?: "pending" | "staff" | "driver";
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
        deposit_method: "" | "口座入金" | "現金入金";
        deposit_date: string | null;
        accounting_assignee: string;
        finance_note: string;
        finance_by_date: Record<string, Record<string, string | number | boolean>>;
      }>;
      drivers: AuditedTable<{
        id: string;
        region_id: string;
        name: string;
        phone: string;
        wechat: string;
        whatsapp: string;
        license_expiry: string | null;
        personal_slogan: string;
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
      driver_wage_items: AuditedTable<{
        id: string;
        region_id: string;
        month: string;
        driver: string;
        company_name: string;
        name: string;
        amount: number;
      }>;
      driver_historical_finance_links: Table<{
        id: string;
        order_id: string;
        service_date: string;
        driver_id: string;
        region_id: string;
        created_by: string;
        created_at: string;
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
      staff_operation_reports: { Args: { target_month: string; target_region: string | null }; Returns: Json };
      staff_operation_report_command: { Args: { command: Json }; Returns: Json };
      admin_driver_logins: { Args: Record<string, never>; Returns: Json };
      admin_driver_login_target: { Args: { target_driver: string }; Returns: Json };
      driver_portal_greetings: { Args: Record<string, never>; Returns: Json };
      admin_update_driver_global_slogan: { Args: { target_slogan: string }; Returns: string };
      bind_driver_identity: { Args: { target_user: string; target_driver: string }; Returns: undefined };
      driver_own_profile: { Args: Record<string, never>; Returns: Json };
      update_driver_own_profile: { Args: { expected_version: number; action: string; contacts: Json }; Returns: Json };
      driver_monthly_shift: { Args: { target_month: string }; Returns: Json };
      submit_driver_monthly_shift: { Args: { target_month: string; expected_version: number; target_request: string; rest_dates: string[]; note: string }; Returns: Json };
      staff_driver_rest_days: { Args: { service_dates: string[] }; Returns: Json };
      driver_finance_data: { Args: { target_month: string }; Returns: Json };
      ensure_driver_historical_finance_links: { Args: { target_month: string }; Returns: undefined };
      driver_historical_finance_data: { Args: { target_month: string }; Returns: Json };
      submit_driver_finance: { Args: { target_assignment: string; target_category: string; expected_version: number; target_request: string; items: Json; hours: number }; Returns: Json };
      submit_driver_historical_finance: { Args: { target_link: string; target_category: string; expected_version: number; target_request: string; items: Json; hours: number }; Returns: Json };
      admin_driver_finance: { Args: { target_month: string }; Returns: Json };
      driver_daily_fuel_data: { Args: { target_month: string }; Returns: Json };
      submit_driver_daily_fuel: { Args: { target_date: string; target_assignment: string; expected_version: number; target_request: string; amount: number; receipts: Json }; Returns: Json };
      admin_driver_daily_fuel: { Args: { target_month: string }; Returns: Json };
      review_driver_daily_fuel: { Args: { target_fuel: string; expected_version: number; decision: string; note: string }; Returns: Json };
      review_driver_finance: { Args: { target_assignment: string; target_category: string; expected_version: number; decision: string; note: string }; Returns: Json };
      allocate_invoice_number: {
        Args: { p_order_id: string; p_company_id: string };
        Returns: string;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_staff: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      driver_identity: {
        Args: Record<string, never>;
        Returns: {
          driver_id: string;
          region_id: string;
          driver_name: string;
          version: number;
        }[];
      };
      driver_orders: {
        Args: { target_date?: string; target_assignment?: string };
        Returns: {
          assignment_id: string; order_id: string; service_date: string;
          departure_time: string; pickup: string; destination: string;
          vehicle: string; status: string; version: number;
        }[];
      };
      driver_historical_orders: {
        Args: { target_date: string };
        Returns: {
          order_id: string; service_date: string; departure_time: string;
          pickup: string; destination: string; vehicle: string;
          vehicle_number: string; order_name: string; trip_summary: string; notes: string;
        }[];
      };
      driver_calendar: {
        Args: { range_start: string; range_end: string };
        Returns: {
          order_id: string; service_date: string; departure_time: string; order_name: string;
          order_status: string; vehicle: string; vehicle_number: string; trip_summary: string;
        }[];
      };
      driver_trip_detail: {
        Args: { target_assignment: string };
        Returns: {
          assignment_id: string; order_id: string; service_date: string;
          departure_time: string; pickup: string; destination: string;
          vehicle: string; status: string; version: number;
          order_name: string; trip_summary: string; notes: string;
        }[];
      };
      acknowledge_driver_assignment: {
        Args: { target_assignment: string; expected_version: number; target_request: string };
        Returns: number;
      };
      update_driver_order_notes: {
        Args: { target_assignment: string; expected_notes: string; target_notes: string };
        Returns: string;
      };
      transition_driver_assignment: {
        Args: { target_assignment: string; expected_version: number; target_request: string; target_state: string };
        Returns: number;
      };
      driver_reports: {
        Args: Record<string, never>;
        Returns: Json;
      };
      driver_report_defaults: {
        Args: { target_date: string };
        Returns: Json;
      };
      staff_order_receipts: {
        Args: { target_order: string; target_date: string };
        Returns: Json;
      };
      admin_order_finance_pending: {
        Args: { target_month: string };
        Returns: Json;
      };
      staff_driver_execution_status: {
        Args: Record<string, never>;
        Returns: Json;
      };
      driver_report_command: {
        Args: { target_report: string | null; expected_version: number; target_request: string; target_action: string; payload: Json };
        Returns: Json;
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
