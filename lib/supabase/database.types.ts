type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<{
        id: string;
        email: string;
        full_name: string;
        company: string;
        position: string;
        role: "admin" | "user";
        email_confirmed: boolean;
        created_at: string;
      }>;
      orders: Table<{
        id: string;
        vehicle: string;
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
      }>;
      drivers: Table<{
        id: string;
        name: string;
        phone: string;
        wechat: string;
        whatsapp: string;
        license_expiry: string | null;
      }>;
      vehicles: Table<{
        id: string;
        name: string;
        plate: string;
        owner_company: string;
        seats: string;
        fuel_type: string;
        inspection_expiry: string | null;
        liability_expiry: string | null;
        notes: string;
        status: "运营中" | "停运中";
      }>;
      order_sources: Table<{
        id: string;
        company_name: string;
        contact_name: string;
        contact_info: string;
        color: string;
      }>;
      companies: Table<{
        id: string;
        name: string;
        operations_manager: string;
        maintenance_manager: string;
        phone: string;
        roll_call_address: string;
        garage_address: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
