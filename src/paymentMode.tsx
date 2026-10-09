import { createContext, useContext } from "react";
import type { AppConfig } from "../shared/types";
import { api, useLoad } from "./api";

const PaymentContext = createContext<AppConfig | null>(null);
export function PaymentProvider({children}: {children: React.ReactNode}) {
  const {data} = useLoad(api.config, []);
  return <PaymentContext.Provider value={data}>{children}</PaymentContext.Provider>;
}
export const usePaymentMode = () => useContext(PaymentContext)?.paypalMode ?? null;
