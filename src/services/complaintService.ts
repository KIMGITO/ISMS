// src/services/complaintService.ts
import { getSupabase } from './supabaseClient';

export interface ComplaintReply {
  id: string;
  author: string;
  role: string;
  message: string;
  timestamp: string;
}

export interface Complaint {
  id: string;
  customerName: string;
  rating: number;
  comment: string;
  timestamp: string;
  resolved: boolean;
  sentiment: 'positive' | 'neutral' | 'negative';
  branch: string;
  replies: ComplaintReply[];
}

export class ComplaintService {
  static async list(businessId: string): Promise<Complaint[]> {
    const { data, error } = await getSupabase()
      .from('complaints')
      .select('id, customer_name, rating, comment, timestamp, resolved, sentiment, branch, complaint_replies(id, author, role, message, timestamp)')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('timestamp', { ascending: false })
      .limit(500);
    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      customerName: row.customer_name,
      rating: row.rating,
      comment: row.comment,
      timestamp: row.timestamp,
      resolved: row.resolved,
      sentiment: row.sentiment,
      branch: row.branch || '',
      replies: [...(row.complaint_replies || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    }));
  }

  static async create(
    businessId: string,
    input: Pick<Complaint, 'customerName' | 'rating' | 'comment' | 'sentiment' | 'branch'>,
  ): Promise<Complaint> {
    const { data, error } = await getSupabase()
      .from('complaints')
      .insert({
        business_id: businessId,
        customer_name: input.customerName,
        rating: input.rating,
        comment: input.comment,
        sentiment: input.sentiment,
        branch: input.branch,
      })
      .select('id, timestamp')
      .single();
    if (error) throw error;
    return { ...input, id: data.id, timestamp: data.timestamp, resolved: false, replies: [] };
  }

  static async setResolved(id: string, resolved: boolean): Promise<void> {
    const { error } = await getSupabase().from('complaints').update({ resolved }).eq('id', id);
    if (error) throw error;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await getSupabase()
      .from('complaints')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  static async addReply(complaintId: string, author: string, role: string, message: string): Promise<ComplaintReply> {
    const { data, error } = await getSupabase()
      .from('complaint_replies')
      .insert({ complaint_id: complaintId, author, role, message })
      .select('id, author, role, message, timestamp')
      .single();
    if (error) throw error;
    return data;
  }
}
