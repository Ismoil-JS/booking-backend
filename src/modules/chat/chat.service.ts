import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { Content } from '@google/genai';
import { TutorService } from '../tutor/tutor.service';
import { ChatRequestDto } from './dto/chat.dto';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const TUTOR_CONTEXT_CACHE_TTL_MS = 60_000; // 1 minute

@Injectable()
export class ChatService {
  private readonly gemini: GoogleGenAI | null;
  private readonly geminiModel: string;
  private tutorContextCache: { text: string; at: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly tutorService: TutorService,
  ) {
    const apiKey =
      this.config.get<string>('GEMINI_API_KEY')?.trim() ||
      this.config.get<string>('GOOGLE_GEMINI_API_KEY')?.trim();
    this.geminiModel = this.config.get<string>('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL;
    this.gemini = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  /** Fetches approved tutors (cached 1 min) and returns a text summary for the AI context. Uses lightweight query. */
  private async getTutorContext(): Promise<string> {
    const now = Date.now();
    if (this.tutorContextCache && now - this.tutorContextCache.at < TUTOR_CONTEXT_CACHE_TTL_MS) {
      return this.tutorContextCache.text;
    }
    const tutors = await this.tutorService.findApprovedForChat();
    let text: string;
    if (!tutors.length) {
      text = 'There are no tutors in the platform yet.';
    } else {
      const lines = tutors.map((t: Record<string, unknown>, i: number) => {
        const u = (t as { user?: { fullName?: string } }).user;
        const cat = (t as { category?: { name?: string } }).category;
        const name = u?.fullName ?? 'Unknown';
        const category = cat?.name ?? 'Uncategorized';
        const cost = (t as { costPer30Min?: unknown }).costPer30Min;
        const price = cost != null ? Number(cost) : null;
        const about = (t as { about?: string }).about ?? '';
        const bio = (t as { bio?: string }).bio ?? '';
        const rating = (t as { rating?: unknown }).rating != null ? Number((t as { rating: unknown }).rating) : null;
        const parts = [
          `${i + 1}. ${name}`,
          `   Category: ${category}`,
          price != null ? `   Price (30 min): $${price}` : '',
          rating != null ? `   Rating: ${rating}` : '',
          about ? `   About: ${about.slice(0, 200)}${about.length > 200 ? '...' : ''}` : '',
          bio ? `   Bio: ${bio.slice(0, 150)}${bio.length > 150 ? '...' : ''}` : '',
        ].filter(Boolean);
        return parts.join('\n');
      });
      text = `There are exactly ${tutors.length} tutor(s) on the platform. This is the complete list—no other tutors exist. Only the fields below are available (we do not have IELTS scores, test dates, or subject specializations in our data):\n\n${lines.join('\n\n')}`;
    }
    this.tutorContextCache = { text, at: now };
    return text;
  }

  private buildGeminiRequest(dto: ChatRequestDto, tutorContext: string): {
    systemInstruction: string;
    contents: Content[];
  } {
    const systemInstruction = `You are a friendly, helpful AI assistant. The user can talk to you about anything—general questions, advice, ideas, or casual conversation. Answer naturally and be helpful.

When the user asks specifically about tutors, teachers, or courses on this platform, use ONLY the following tutor list. Do not invent names or details; only refer to tutors and facts from this list. If nothing in the list matches their request, say so and mention who is available. For any other topic, chat freely—you are not limited to the platform.

Tutor list (use only when the user asks about tutors/teachers on this site):

${tutorContext}`;
    const contents: Content[] = [];
    if (dto.messages?.length) {
      for (const m of dto.messages) {
        if (m.role === 'system') continue;
        const role = m.role === 'assistant' ? 'model' : 'user';
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }
    contents.push({ role: 'user', parts: [{ text: dto.message }] });
    return { systemInstruction, contents };
  }

  private geminiNotConfiguredMessage(): string {
    return 'Gemini is not configured. Set GEMINI_API_KEY in .env (get a key at https://aistudio.google.com/apikey). You can also use GOOGLE_GEMINI_API_KEY.';
  }

  async chat(dto: ChatRequestDto): Promise<{ reply: string }> {
    if (!this.gemini) {
      throw new ServiceUnavailableException(this.geminiNotConfiguredMessage());
    }
    const tutorContext = await this.getTutorContext();
    const { systemInstruction, contents } = this.buildGeminiRequest(dto, tutorContext);
    try {
      const response = await this.gemini.models.generateContent({
        model: this.geminiModel,
        contents,
        config: { systemInstruction },
      });
      const reply = response.text?.trim() ?? '';
      return { reply: reply || 'No response.' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(`Gemini error: ${msg.slice(0, 300)}`);
    }
  }

  async *chatStream(dto: ChatRequestDto): AsyncGenerator<string> {
    if (!this.gemini) {
      throw new ServiceUnavailableException(this.geminiNotConfiguredMessage());
    }
    const tutorContext = await this.getTutorContext();
    const { systemInstruction, contents } = this.buildGeminiRequest(dto, tutorContext);
    try {
      const stream = await this.gemini.models.generateContentStream({
        model: this.geminiModel,
        contents,
        config: { systemInstruction },
      });
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) yield text;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(`Gemini error: ${msg.slice(0, 300)}`);
    }
  }
}
