// src/features/analytics/infrastructure/SQLiteExpenseRepository.ts
import { ExpenseRepositoryPort, ExpenseCategoryRepositoryPort } from "../domain/ports";
import { ExpenseRepository, ExpenseCategoryRepository } from "../../../services/repositories";
import { Expense, ExpenseCategory } from "../../../types";
import { SQLiteRow } from "../domain/ports";

export class SQLiteExpenseRepository implements ExpenseRepositoryPort {
  public getAll(): SQLiteRow<Expense>[] {
    return ExpenseRepository.getAll();
  }

  public getById(id: string): SQLiteRow<Expense> | null {
    return ExpenseRepository.getById(id);
  }

  public add(expense: Omit<Expense, "created_at" | "updated_at">): Promise<SQLiteRow<Expense>> {
    return ExpenseRepository.add(expense);
  }

  public update(id: string, updates: Partial<Expense>): Promise<SQLiteRow<Expense> | null> {
    return ExpenseRepository.update(id, updates);
  }

  public delete(id: string): Promise<boolean> {
    return ExpenseRepository.delete(id);
  }

  public subscribe(callback: (expenses: SQLiteRow<Expense>[]) => void): () => void {
    return ExpenseRepository.subscribe(callback);
  }
}

export class SQLiteExpenseCategoryRepository implements ExpenseCategoryRepositoryPort {
  public getAll(): SQLiteRow<ExpenseCategory>[] {
    return ExpenseCategoryRepository.getAll();
  }

  public getById(id: string): SQLiteRow<ExpenseCategory> | null {
    return ExpenseCategoryRepository.getById(id);
  }

  public add(category: Omit<ExpenseCategory, "created_at" | "updated_at">): Promise<SQLiteRow<ExpenseCategory>> {
    return ExpenseCategoryRepository.add(category);
  }

  public update(id: string, updates: Partial<ExpenseCategory>): Promise<SQLiteRow<ExpenseCategory> | null> {
    return ExpenseCategoryRepository.update(id, updates);
  }

  public delete(id: string): Promise<boolean> {
    return ExpenseCategoryRepository.delete(id);
  }

  public subscribe(callback: (categories: SQLiteRow<ExpenseCategory>[]) => void): () => void {
    return ExpenseCategoryRepository.subscribe(callback);
  }
}
