import { useState, ChangeEvent, FormEvent } from "react";
import { formatName } from "../utils/stringUtils";

interface FormOptions<T> {
  initialValues: T;
  validate?: (values: T) => Partial<Record<keyof T, string>>;
  onSubmit: (values: T) => void | Promise<void>;
}

export function useForm<T extends Record<string, any>>({
  initialValues,
  validate,
  onSubmit,
}: FormOptions<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    let finalValue: any = value;

    if (type === "number") {
      finalValue = value === "" ? "" : Number(value);
    } else if (type === "checkbox") {
      finalValue = (e.target as HTMLInputElement).checked;
    } else if (typeof value === "string") {
      finalValue = value;
    }

    setValues((prev) => ({
      ...prev,
      [name]: finalValue,
    }));

    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const handleCustomChange = (name: keyof T, value: any) => {
    setValues((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedValues = { ...values };
    for (const key in trimmedValues) {
      if (typeof trimmedValues[key] === "string") {
        const trimmed = trimmedValues[key].trim();
        if (key.toLowerCase().includes("name")) {
          trimmedValues[key] = formatName(trimmed) as any;
        } else {
          trimmedValues[key] = trimmed as any;
        }
      }
    }

    if (validate) {
      const validationErrors = validate(trimmedValues);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onSubmit(trimmedValues);
      resetForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setValues(initialValues);
    setErrors({});
  };

  return {
    values,
    errors,
    isSubmitting,
    handleChange,
    handleCustomChange,
    handleSubmit,
    resetForm,
    setValues,
  };
}

