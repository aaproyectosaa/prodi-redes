import { forwardRef, useLayoutEffect, useRef, type ChangeEvent, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/**
 * Campo de números con los puntos de miles a medida que se escribe ("450.000", "1.234,5").
 * Por fuera se maneja igual que antes: `value` y `onChange` usan el número "crudo" sin puntos
 * ("450000"; con decimales, punto: "1234.5"), así quien lo usa no cambia nada.
 */
type Props = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string | number | null | undefined;
  onChange: (e: { target: { value: string } }) => void;
  /** Acepta coma decimal (hasta 2). */
  decimales?: boolean;
  /** Acepta signo menos (ajustes que descuentan). */
  negativos?: boolean;
};

const miles = (entero: string) => entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** "1234.5" → "1.234,5" */
function mostrar(raw: string, decimales: boolean): string {
  if (!raw) return "";
  const neg = raw.startsWith("-");
  const [ent, dec] = raw.replace(/^-/, "").split(".");
  const entero = miles(ent.replace(/^0+(?=\d)/, ""));
  return `${neg ? "-" : ""}${entero}${decimales && dec !== undefined ? `,${dec}` : ""}`;
}

/** Lo que escribió la persona ("1.234,5") → crudo ("1234.5"). */
function crudo(txt: string, decimales: boolean, negativos: boolean): string {
  const neg = negativos && txt.trim().startsWith("-");
  let t = txt.replace(/\./g, "");
  if (decimales) {
    const [ent, ...resto] = t.split(",");
    const dec = resto.join("").replace(/\D/g, "").slice(0, 2);
    t = ent.replace(/\D/g, "") + (t.includes(",") ? `.${dec}` : "");
  } else t = t.replace(/\D/g, "");
  return (neg ? "-" : "") + t;
}

/** Valor que viene de afuera (número o texto viejo) → crudo. */
function normalizar(v: Props["value"], decimales: boolean): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(decimales ? Math.round(v * 100) / 100 : Math.round(v)) : "";
  const s = String(v);
  // Ya crudo ("450000", "1234.5", "-200").
  if (/^-?\d*(\.\d*)?$/.test(s)) return decimales ? s : s.split(".")[0];
  return crudo(s, decimales, true);
}

export const InputNumero = forwardRef<HTMLInputElement, Props>(function InputNumero({ value, onChange, decimales = false, negativos = false, ...rest }, ref) {
  const interno = useRef<HTMLInputElement | null>(null);
  // Dónde dejar el cursor después de poner los puntos: cuántos dígitos tenía antes.
  const digitosAntes = useRef<number | null>(null);
  const texto = mostrar(normalizar(value, decimales), decimales);

  useLayoutEffect(() => {
    const el = interno.current;
    const n = digitosAntes.current;
    if (!el || n === null || document.activeElement !== el) return;
    digitosAntes.current = null;
    let pos = 0;
    let vistos = 0;
    while (pos < texto.length && vistos < n) {
      if (/[\d,-]/.test(texto[pos])) vistos++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
  }, [texto]);

  return (
    <Input
      {...rest}
      ref={(el) => {
        interno.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      type="text"
      inputMode={decimales ? "decimal" : "numeric"}
      value={texto}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const cursor = e.target.selectionStart ?? e.target.value.length;
        digitosAntes.current = e.target.value.slice(0, cursor).replace(/[^\d,-]/g, "").length;
        onChange({ target: { value: crudo(e.target.value, decimales, negativos) } });
      }}
    />
  );
});
