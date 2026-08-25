// Generated from the live schema. Regenerate after any migration with:
//   supabase gen types typescript --project-id vbotzafrmgkvncdsdfut > src/integrations/supabase/types.ts
// Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      credit_transactions: {
        Row: { amount: number; created_at: string; id: string; metadata: Json; reason: string; user_id: string }
        Insert: { amount: number; created_at?: string; id?: string; metadata?: Json; reason: string; user_id: string }
        Update: { amount?: number; created_at?: string; id?: string; metadata?: Json; reason?: string; user_id?: string }
        Relationships: []
      }
      feedback: {
        Row: { created_at: string; id: string; message: string; page: string | null; user_id: string | null }
        Insert: { created_at?: string; id?: string; message: string; page?: string | null; user_id?: string | null }
        Update: { created_at?: string; id?: string; message?: string; page?: string | null; user_id?: string | null }
        Relationships: []
      }
      manual_completions: {
        Row: {
          completed_at: string
          confidence: Database["public"]["Enums"]["self_confidence"]
          id: string
          question_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          confidence?: Database["public"]["Enums"]["self_confidence"]
          id?: string
          question_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          confidence?: Database["public"]["Enums"]["self_confidence"]
          id?: string
          question_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_completions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: { created_at: string; email: string; full_name: string | null; id: string; updated_at: string; user_id: string }
        Insert: { created_at?: string; email: string; full_name?: string | null; id?: string; updated_at?: string; user_id: string }
        Update: { created_at?: string; email?: string; full_name?: string | null; id?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      question_parts: {
        Row: { description: string; id: string; label: string | null; marks: number; position: number; question_id: string }
        Insert: { description: string; id?: string; label?: string | null; marks: number; position: number; question_id: string }
        Update: { description?: string; id?: string; label?: string | null; marks?: number; position?: number; question_id?: string }
        Relationships: [
          {
            foreignKeyName: "question_parts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_subtopics: {
        Row: { is_primary: boolean; question_id: string; subtopic_id: string }
        Insert: { is_primary?: boolean; question_id: string; subtopic_id: string }
        Update: { is_primary?: boolean; question_id?: string; subtopic_id?: string }
        Relationships: [
          {
            foreignKeyName: "question_subtopics_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_subtopics_subtopic_id_fkey"
            columns: ["subtopic_id"]
            isOneToOne: false
            referencedRelation: "subtopics"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          calculator: boolean | null
          created_at: string
          dependency: Database["public"]["Enums"]["question_dependency"]
          has_diagram: boolean
          id: string
          is_published: boolean
          marks: number
          markscheme_image_path: string | null
          markscheme_text: string | null
          paper: number | null
          primary_topic_id: string | null
          question_image_path: string | null
          question_number: number
          question_text: string | null
          sitting: Database["public"]["Enums"]["exam_sitting"]
          source_file: string | null
          summary: string | null
          tier: Database["public"]["Enums"]["tier"]
          updated_at: string
          variant: number
          year: number
        }
        Insert: {
          calculator?: boolean | null
          created_at?: string
          dependency?: Database["public"]["Enums"]["question_dependency"]
          has_diagram?: boolean
          id?: string
          is_published?: boolean
          marks: number
          markscheme_image_path?: string | null
          markscheme_text?: string | null
          paper?: number | null
          primary_topic_id?: string | null
          question_image_path?: string | null
          question_number: number
          question_text?: string | null
          sitting: Database["public"]["Enums"]["exam_sitting"]
          source_file?: string | null
          summary?: string | null
          tier?: Database["public"]["Enums"]["tier"]
          updated_at?: string
          variant: number
          year: number
        }
        Update: {
          calculator?: boolean | null
          created_at?: string
          dependency?: Database["public"]["Enums"]["question_dependency"]
          has_diagram?: boolean
          id?: string
          is_published?: boolean
          marks?: number
          markscheme_image_path?: string | null
          markscheme_text?: string | null
          paper?: number | null
          primary_topic_id?: string | null
          question_image_path?: string | null
          question_number?: number
          question_text?: string | null
          sitting?: Database["public"]["Enums"]["exam_sitting"]
          source_file?: string | null
          summary?: string | null
          tier?: Database["public"]["Enums"]["tier"]
          updated_at?: string
          variant?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "questions_primary_topic_id_fkey"
            columns: ["primary_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      student_attempts: {
        Row: {
          ai_feedback: string | null
          attempted: boolean
          created_at: string
          id: string
          mark_breakdown: Json | null
          marks_awarded: number | null
          nature_of_errors: string | null
          percentage_attained: number | null
          question_id: string
          updated_at: string
          user_id: string
          work_image_paths: string[] | null
        }
        Insert: {
          ai_feedback?: string | null
          attempted?: boolean
          created_at?: string
          id?: string
          mark_breakdown?: Json | null
          marks_awarded?: number | null
          nature_of_errors?: string | null
          percentage_attained?: number | null
          question_id: string
          updated_at?: string
          user_id: string
          work_image_paths?: string[] | null
        }
        Update: {
          ai_feedback?: string | null
          attempted?: boolean
          created_at?: string
          id?: string
          mark_breakdown?: Json | null
          marks_awarded?: number | null
          nature_of_errors?: string | null
          percentage_attained?: number | null
          question_id?: string
          updated_at?: string
          user_id?: string
          work_image_paths?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "student_attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      subtopics: {
        Row: { code: string; id: string; position: number; title: string; topic_id: string }
        Insert: { code: string; id?: string; position: number; title: string; topic_id: string }
        Update: { code?: string; id?: string; position?: number; title?: string; topic_id?: string }
        Relationships: [
          {
            foreignKeyName: "subtopics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: { id: string; name: string; section_number: number; tier: Database["public"]["Enums"]["tier"] }
        Insert: { id?: string; name: string; section_number: number; tier?: Database["public"]["Enums"]["tier"] }
        Update: { id?: string; name?: string; section_number?: number; tier?: Database["public"]["Enums"]["tier"] }
        Relationships: []
      }
      user_credits: {
        Row: { balance: number; updated_at: string; user_id: string }
        Insert: { balance?: number; updated_at?: string; user_id: string }
        Update: { balance?: number; updated_at?: string; user_id?: string }
        Relationships: []
      }
      user_roles: {
        Row: { created_at: string; id: string; role: Database["public"]["Enums"]["app_role"]; user_id: string }
        Insert: { created_at?: string; id?: string; role: Database["public"]["Enums"]["app_role"]; user_id: string }
        Update: { created_at?: string; id?: string; role?: Database["public"]["Enums"]["app_role"]; user_id?: string }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deduct_credits: {
        Args: { _base_cost: number; _metadata?: Json; _reason: string; _user_id: string }
        Returns: Json
      }
      grant_credits: {
        Args: { _amount: number; _metadata?: Json; _reason?: string; _user_id: string }
        Returns: number
      }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"]; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "student"
      exam_sitting: "Feb-March" | "May-June" | "Oct-Nov"
      question_dependency: "single" | "linked" | "independent"
      self_confidence: "easy" | "ok" | "struggled"
      tier: "core" | "extended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> = DefaultSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "student"],
      exam_sitting: ["Feb-March", "May-June", "Oct-Nov"],
      question_dependency: ["single", "linked", "independent"],
      self_confidence: ["easy", "ok", "struggled"],
      tier: ["core", "extended"],
    },
  },
} as const
