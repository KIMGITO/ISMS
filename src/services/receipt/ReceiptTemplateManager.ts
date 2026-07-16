import React from "react";
import { ReceiptTemplateType } from "./types";
import { ClassicTemplate } from "./templates/classic";
import { ModernTemplate } from "./templates/modern";
import { CompactTemplate } from "./templates/compact";
import { RetailTemplate } from "./templates/retail";
import { MilkShopTemplate } from "./templates/milkShop";

export interface TemplateRegistryEntry {
  type: ReceiptTemplateType;
  name: string;
  description: string;
  component: React.ComponentType<any>;
}

export class ReceiptTemplateManager {
  private static registry: Record<ReceiptTemplateType, TemplateRegistryEntry> = {
    classic: {
      type: "classic",
      name: "Classic",
      description: "Clean traditional mono-spaced receipt, ideal for standard retail counters.",
      component: ClassicTemplate
    },
    modern: {
      type: "modern",
      name: "Modern Clean",
      description: "Elegant sans-serif fonts, rounded blocks, and high visual hierarchy.",
      component: ModernTemplate
    },
    compact: {
      type: "compact",
      name: "Super Compact",
      description: "Tight margins, tiny font, optimized to minimize paper waste.",
      component: CompactTemplate
    },
    retail: {
      type: "retail",
      name: "Retail Audit",
      description: "High density itemization, detailed tax tables, and prominent barcode.",
      component: RetailTemplate
    },
    milk_shop: {
      type: "milk_shop",
      name: "KayKay's Farm Milk Shop",
      description: "Charming emerald borders and cow motifs custom crafted for dairy logisticians.",
      component: MilkShopTemplate
    }
  };

  /**
   * Retrieves a template component by its unique string type.
   */
  public static getTemplate(type: ReceiptTemplateType): React.ComponentType<any> {
    const entry = this.registry[type] || this.registry.classic;
    return entry.component;
  }

  /**
   * Lists all currently registered templates.
   */
  public static getAvailableTemplates(): TemplateRegistryEntry[] {
    return Object.values(this.registry);
  }

  /**
   * Registers a new custom template (Extensibility)
   */
  public static registerTemplate(
    type: ReceiptTemplateType, 
    name: string, 
    description: string, 
    component: React.ComponentType<any>
  ): void {
    this.registry[type] = { type, name, description, component };
  }
}
