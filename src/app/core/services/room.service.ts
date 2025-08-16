import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';

// Use dynamic import for socket.io-client to avoid TypeScript import issues
declare const require: any;
const io = require('socket.io-client');

export interface User {
  id: string;
  name: string;
  estimate?: number | string;
  hasVoted: boolean;
  isAdmin?: boolean;
  connected?: boolean;
}

export interface Room {
  id: string;
  name: string;
  userCount: number;
  adminName: string;
  story: Story;
  votingRevealed: boolean;
  estimationStarted: boolean;
  createdAt: Date;
  lastActivity: Date;
}

export interface Story {
  title: string;
  description: string;
}

export interface VotingResults {
  totalVotes: number;
  estimates: { [key: string]: number };
  averageEstimate?: number;
  mostCommonEstimate?: string;
  revealed?: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class RoomService {
  private readonly baseUrl = 'https://storypointpoker-backend-production.up.railway.app/api';
  //private readonly baseUrl = 'http://localhost:3000/api';
  private socket: any;

  // Reactive state management
  private usersSubject = new BehaviorSubject<User[]>([]);
  private roomSubject = new BehaviorSubject<Room | null>(null);
  private votingResultsSubject = new BehaviorSubject<VotingResults | null>(null);
  private estimationStartedSubject = new BehaviorSubject<boolean>(false);
  private resultsRevealedSubject = new BehaviorSubject<boolean>(false);

  public users$ = this.usersSubject.asObservable();
  public room$ = this.roomSubject.asObservable();
  public votingResults$ = this.votingResultsSubject.asObservable();
  public estimationStarted$ = this.estimationStartedSubject.asObservable();
  public resultsRevealed$ = this.resultsRevealedSubject.asObservable();

  constructor(private http: HttpClient) {
    this.initializeSocket();
  }

  private initializeSocket(): void {
    this.socket = io('https://storypointpoker-backend-production.up.railway.app', {
      transports: ['websocket', 'polling']
    });

    // this.socket = io('http://localhost:3000', {
    //   transports: ['websocket', 'polling']
    // });

    // Socket event listeners
    this.socket.on('room-state', (data: { room: Room; users: User[]; results: VotingResults }) => {
      this.roomSubject.next(data.room);
      this.usersSubject.next(data.users);
      this.votingResultsSubject.next(data.results);
      this.resultsRevealedSubject.next(data.room.votingRevealed);
    });

    this.socket.on('user-joined', (data: { user: User; room: Room; users: User[] }) => {
      this.usersSubject.next(data.users);
      this.roomSubject.next(data.room);
    });

    this.socket.on('user-left', (data: { userId: string; room: Room; users: User[] }) => {
      this.usersSubject.next(data.users);
      this.roomSubject.next(data.room);
    });

    this.socket.on('user-disconnected', (data: { userId: string; users: User[] }) => {
      this.usersSubject.next(data.users);
    });

    this.socket.on('vote-submitted', (data: { userId: string; users: User[]; results: VotingResults }) => {
      this.usersSubject.next(data.users);
      this.votingResultsSubject.next(data.results);
    });

    this.socket.on('votes-revealed', (data: { revealed: boolean; votes: User[]; summary: any }) => {
      // Convert the backend summary to our VotingResults format
      const estimates: { [key: string]: number } = {};
      data.votes.forEach(user => {
        if (user.hasVoted && user.estimate) {
          const estimate = user.estimate.toString();
          estimates[estimate] = (estimates[estimate] || 0) + 1;
        }
      });

      const votingResults: VotingResults = {
        totalVotes: data.summary?.totalVotes || 0,
        estimates: estimates,
        averageEstimate: undefined, // Can calculate later if needed
        mostCommonEstimate: data.summary?.mostCommon,
        revealed: data.revealed // Include revealed state
      };

      this.votingResultsSubject.next(votingResults);
      this.usersSubject.next(data.votes); // votes array contains updated users with estimates
      this.resultsRevealedSubject.next(data.revealed);
    });

    this.socket.on('voting-reset', (data: { users: User[]; results: VotingResults }) => {
      this.usersSubject.next(data.users);
      this.votingResultsSubject.next(data.results);
      this.resultsRevealedSubject.next(false);
      this.estimationStartedSubject.next(false);
    });

    this.socket.on('estimation-started', (data: { users: User[]; results: VotingResults }) => {
      this.usersSubject.next(data.users);
      this.votingResultsSubject.next(data.results);
      this.estimationStartedSubject.next(true);
      this.resultsRevealedSubject.next(false);
    });

    this.socket.on('story-updated', (data: { story: Story; room: Room }) => {
      const currentRoom = this.roomSubject.value;
      if (currentRoom) {
        this.roomSubject.next({ ...currentRoom, story: data.story });
      }
    });

    this.socket.on('error', (error: { message: string }) => {
      console.error('Socket error:', error.message);
    });
  }

  // Room operations
  createRoom(roomName: string, adminName: string): Observable<ApiResponse<{ roomId: string; userId: string }>> {
    return this.http.post<ApiResponse<{ roomId: string; userId: string }>>(`${this.baseUrl}/rooms`, {
      roomName,
      adminName
    });
  }

  joinRoom(roomId: string, userName: string, isAdmin: boolean = false): Observable<ApiResponse<{ userId: string }>> {
    return this.http.post<ApiResponse<{ userId: string }>>(`${this.baseUrl}/rooms/${roomId}/join`, {
      userName,
      isAdmin
    });
  }

  leaveRoom(roomId: string, userId: string): Observable<ApiResponse> {
    return this.http.delete<ApiResponse>(`${this.baseUrl}/rooms/${roomId}/users/${userId}`);
  }

  getRoomDetails(roomId: string): Observable<ApiResponse<Room>> {
    return this.http.get<ApiResponse<Room>>(`${this.baseUrl}/rooms/${roomId}`);
  }

  getRoomUsers(roomId: string): Observable<ApiResponse<User[]>> {
    return this.http.get<ApiResponse<User[]>>(`${this.baseUrl}/rooms/${roomId}/users`);
  }

  // Story operations
  updateStory(roomId: string, userId: string, title: string, description: string): Observable<ApiResponse> {
    return this.http.put<ApiResponse>(`${this.baseUrl}/rooms/${roomId}/story`, {
      userId,
      title,
      description
    });
  }

  // Voting operations
  submitVote(roomId: string, userId: string, estimate: string): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.baseUrl}/rooms/${roomId}/vote`, {
      userId,
      estimate
    });
  }

  revealVotes(roomId: string, userId: string): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.baseUrl}/rooms/${roomId}/reveal`, {
      userId
    });
  }

  resetVoting(roomId: string, userId: string): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.baseUrl}/rooms/${roomId}/reset`, {
      userId
    });
  }

  getVotingResults(roomId: string): Observable<ApiResponse<VotingResults>> {
    return this.http.get<ApiResponse<VotingResults>>(`${this.baseUrl}/rooms/${roomId}/results`);
  }

  // Socket operations
  joinSocketRoom(roomId: string, userId: string): void {
    if (!this.socket.connected) {
      this.socket.connect();
      this.socket.on('connect', () => {
        this.socket.emit('join-room', { roomId, userId });
      });
    } else {
      this.socket.emit('join-room', { roomId, userId });
    }
  }

  leaveSocketRoom(roomId: string, userId: string): void {
    this.socket.emit('leave-room', { roomId, userId });
  }

  submitVoteSocket(roomId: string, userId: string, estimate: string): void {
    this.socket.emit('submit-vote', { roomId, userId, estimate });
  }

  revealVotesSocket(roomId: string, userId: string): void {
    this.socket.emit('reveal-votes', { roomId, userId });
  }

  resetVotingSocket(roomId: string, userId: string): void {
    this.socket.emit('reset-voting', { roomId, userId });
  }

  updateStorySocket(roomId: string, userId: string, title: string, description: string): void {
    this.socket.emit('update-story', { roomId, userId, title, description });
  }

  startEstimationSocket(roomId: string, userId: string): void {
    this.socket.emit('start-estimation', { roomId, userId });
  }

  // Cleanup
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  // Getters for current state
  get currentUsers(): User[] {
    return this.usersSubject.value;
  }

  get currentRoom(): Room | null {
    return this.roomSubject.value;
  }

  get currentVotingResults(): VotingResults | null {
    return this.votingResultsSubject.value;
  }

  get isEstimationStarted(): boolean {
    return this.estimationStartedSubject.value;
  }

  get areResultsRevealed(): boolean {
    return this.resultsRevealedSubject.value;
  }
}