"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Options = {
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
};

/**
 * Carrega as linhas de uma tabela do workspace e recarrega sozinho
 * quando qualquer membro muda algo (Supabase Realtime).
 */
export function useTable<T>(table: string, workspaceId: string, opts: Options = {}) {
  const { orderBy = "created_at", ascending = false, limit = 200 } = opts;
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from(table)
      .select("*")
      .eq("workspace_id", workspaceId)
      .order(orderBy, { ascending })
      .limit(limit);
    setRows((data as T[]) ?? []);
    setLoading(false);
  }, [table, workspaceId, orderBy, ascending, limit]);

  useEffect(() => {
    reload();
    const supabase = createClient();
    const channel = supabase
      .channel(`${table}-${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` },
        () => reload()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, workspaceId, reload]);

  return { rows, loading, reload };
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
