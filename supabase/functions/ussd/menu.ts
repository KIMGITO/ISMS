// supabase/functions/ussd/menu.ts
// The dial-code menu as a pure function, so it can be tested without a gateway.
// The gateway resends every answer so far on each request, joined by "*".

export interface UssdProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
  stock: number;
}

export interface UssdContext {
  shopName: string;
  registered: boolean;
  products: UssdProduct[];
  zones: { id: string; name: string; fee: number }[];
  deliveryEnabled: boolean;
  deliveryFee: number;
  summary?: string;
  orders?: string;
}

export type UssdAction =
  | { type: "register"; name: string }
  | {
    type: "order";
    productId: string;
    quantity: number;
    fulfilment: "pickup" | "delivery";
    zoneId: string | null;
    address: string | null;
  };

export interface UssdReply {
  text: string;
  action?: UssdAction;
}

const MAX_PRODUCTS = 7;

const more = (text: string): UssdReply => ({ text: `CON ${text}` });
const end = (text: string): UssdReply => ({ text: `END ${text}` });

function pick<T>(answer: string, list: T[]): T | null {
  const index = Number(answer) - 1;
  return Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : null;
}

function orderFlow(steps: string[], ctx: UssdContext): UssdReply {
  const products = ctx.products.filter((p) => p.stock > 0).slice(0, MAX_PRODUCTS);
  if (products.length === 0) return end("Sorry, nothing is available to order right now.");

  if (steps.length === 0) {
    const lines = products.map((p, i) => `${i + 1}. ${p.name} - ${p.price}/${p.unit}`);
    return more(`Choose a product:\n${lines.join("\n")}`);
  }

  const product = pick(steps[0], products);
  if (!product) return end("That choice isn't on the list. Please dial again.");
  if (steps.length === 1) return more(`How many ${product.unit} of ${product.name}?`);

  const quantity = Number(steps[1]);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) {
    return end("That amount isn't valid. Please dial again.");
  }
  // Customers are never told exact stock.
  if (quantity > product.stock) return end(`We don't have that much ${product.name} right now. Please try a smaller amount.`);
  const subtotal = product.price * quantity;

  // Without delivery there's nothing to ask, so an empty answer stands for pickup.
  const answers = ctx.deliveryEnabled ? steps.slice(2) : ["2", ...steps.slice(2)];
  if (answers.length === 0) return more("1. Delivery\n2. Pickup");

  const delivery = answers[0] === "1";
  if (!delivery && answers[0] !== "2") return end("That choice isn't on the list. Please dial again.");

  let rest = answers.slice(1);
  let zone: UssdContext["zones"][number] | null = null;
  let address: string | null = null;
  let fee = 0;

  if (delivery) {
    fee = ctx.deliveryFee;
    if (ctx.zones.length > 0) {
      if (rest.length === 0) {
        const lines = ctx.zones.slice(0, MAX_PRODUCTS).map((z, i) => `${i + 1}. ${z.name} - ${z.fee}`);
        return more(`Choose your area:\n${lines.join("\n")}`);
      }
      zone = pick(rest[0], ctx.zones.slice(0, MAX_PRODUCTS));
      if (!zone) return end("That choice isn't on the list. Please dial again.");
      fee = zone.fee;
      rest = rest.slice(1);
    }
    if (rest.length === 0) return more("Enter your delivery location:");
    address = rest[0].trim();
    if (!address) return end("Please dial again and enter your location.");
    rest = rest.slice(1);
  }

  if (rest.length === 0) {
    const total = Math.floor(subtotal + fee);
    return more(`${quantity} ${product.unit} ${product.name}\nTotal Ksh ${total}\n1. Pay by M-Pesa\n2. Cancel`);
  }
  if (rest[0] !== "1") return end("Your order was cancelled.");

  return {
    text: "END Please enter your M-Pesa PIN when the prompt appears on your phone.",
    action: {
      type: "order",
      productId: product.id,
      quantity,
      fulfilment: delivery ? "delivery" : "pickup",
      zoneId: zone?.id ?? null,
      address,
    },
  };
}

/** text is the gateway's raw answer string, such as "1*2*3". */
export function respond(text: string, ctx: UssdContext): UssdReply {
  const steps = text === "" ? [] : text.split("*");

  if (!ctx.registered) {
    if (steps.length === 0) return more(`Welcome to ${ctx.shopName}.\nEnter your name to create your account:`);
    const name = steps[0].trim();
    if (!name) return end("Please dial again and enter your name.");
    return {
      text: `END Thank you ${name}. Your account is ready. Dial again to order.`,
      action: { type: "register", name },
    };
  }

  if (steps.length === 0) {
    return more(`${ctx.shopName}\n1. Order\n2. My orders\n3. Points and balance`);
  }
  if (steps[0] === "1") return orderFlow(steps.slice(1), ctx);
  if (steps[0] === "2") return end(ctx.orders || "You have no orders yet.");
  if (steps[0] === "3") return end(ctx.summary || "Your balance isn't available right now.");
  return end("That choice isn't on the list. Please dial again.");
}
