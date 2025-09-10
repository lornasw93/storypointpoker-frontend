import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService, User as BackendUser, Room as BackendRoom, VotingResults } from '../core/services/room.service';
import Swal from 'sweetalert2';
// @ts-ignore
import confetti from 'canvas-confetti';

interface User {
  id: string;
  name: string;
  estimate?: number | string;
  hasVoted: boolean;
  isAdmin?: boolean;
}

interface ChartSegment {
  label: string;
  value: number;
  percentage: number;
  color: string;
  offset: number;
  pathData?: string;
}

@Component({
  selector: 'app-room',
  templateUrl: './room.component.html',
  styleUrls: ['./room.component.scss']
})
export class RoomComponent implements OnInit, OnDestroy {
  roomId: string = '';
  currentUser: User | null = null;
  users: User[] = [];
  storyPoints = [1, 3, 5, 8, 13];
  specialOptions = [
    { value: 'info', label: '❓ Need more info', shortLabel: '❓' },
    { value: 'split', label: '✂️ Story too big', shortLabel: '✂️' }
  ];
  selectedEstimate: number | string | null = null;
  showNameDialog = false;
  userName = '';
  isAdmin = false;

  storySummary = '';
  isEditingStory = false;

  roomClosed = false;
  room: BackendRoom | null = null;

  estimationStarted = false;
  resultsRevealed = false;

  chartSegments: ChartSegment[] = [];
  chartRadius = 160;
  chartCenterX = 175;
  chartCenterY = 175;

  private subscriptions: Subscription[] = [];

  urlCopied = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private roomService: RoomService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.roomId = this.route.snapshot.params['id'];

    // Check if user has already joined
    const savedUser = localStorage.getItem(`room_${this.roomId}_user`);

    if (savedUser) {
      const userData = JSON.parse(savedUser);
      this.currentUser = userData;
      // Trust the backend data for admin status
      this.isAdmin = userData.isAdmin || false;

      // Join the room with existing user data
      this.joinRoomWithExistingUser();
    } else {
      // New user needs to enter name (and will be regular user, not admin)
      this.isAdmin = false;
      this.showNameDialog = true;
    }

    // Subscribe to room service observables
    this.setupSubscriptions();
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());

    // Leave socket room if connected
    if (this.currentUser) {
      this.roomService.leaveSocketRoom(this.roomId, this.currentUser.id);
    }
  }

  private setupSubscriptions(): void {
    // Subscribe to users updates
    this.subscriptions.push(
      this.roomService.users$.subscribe(users => {
        this.users = users;
        this.updateChartData();
      })
    );

    // Subscribe to room updates
    this.subscriptions.push(
      this.roomService.room$.subscribe(room => {
        this.room = room;
        if (room?.story) {
          this.storySummary = room.story.title || room.story.description || '';
        }
      })
    );

    // Subscribe to voting results
    this.subscriptions.push(
      this.roomService.votingResults$.subscribe(results => {
        if (results) {
          this.updateChartData();
        }
      })
    );

    // Subscribe to estimation state
    this.subscriptions.push(
      this.roomService.estimationStarted$.subscribe(started => {
        this.estimationStarted = started;
      })
    );

    // Subscribe to results revealed state
    this.subscriptions.push(
      this.roomService.resultsRevealed$.subscribe(revealed => {
        this.resultsRevealed = revealed;
        if (revealed) {
          this.updateChartData();

          // Clear the selected estimate when results are revealed
          this.selectedEstimate = null;

          this.showConfetti();
        }
      })
    );
  }

  private joinRoomWithExistingUser(): void {
    if (!this.currentUser) return;

    // Join socket room for real-time updates
    this.roomService.joinSocketRoom(this.roomId, this.currentUser.id);

    this.roomService.getRoomDetails(this.roomId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.estimationStarted = response.data.estimationStarted || false;
          this.resultsRevealed = response.data.votingRevealed || false;

          this.roomService.getRoomUsers(this.roomId).subscribe({
            next: (usersResponse) => {
              if (usersResponse.success && usersResponse.data) {
                this.users = usersResponse.data;
              }
            }
          });
        }
      },
      error: (error) => {
        this.roomClosed = true;

        Swal.fire({
          icon: 'error',
          title: 'Room Not Found',
          text: 'This room doesn\'t exist or has been closed.',
          confirmButtonText: 'Go Home'
        }).then(() => {
          this.router.navigate(['/']);
        });
      }
    });
  }

  joinRoom(): void {
    if (this.userName.trim()) {
      this.roomService.joinRoom(this.roomId, this.userName.trim(), this.isAdmin).subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.currentUser = {
              id: response.data.userId,
              name: this.userName.trim(),
              hasVoted: false,
              isAdmin: this.isAdmin
            };

            localStorage.setItem(`room_${this.roomId}_user`, JSON.stringify(this.currentUser));

            this.roomService.joinSocketRoom(this.roomId, this.currentUser.id);

            this.showNameDialog = false;
            this.userName = '';
          }
        },
        error: (error) => {
          Swal.fire({
            icon: 'error',
            title: 'Failed to Join Room',
            text: 'Unable to join the room. Please check your connection and try again.',
            confirmButtonText: 'OK'
          });
        }
      });
    }
  }

  selectEstimate(point: number | string): void {
    if (!this.estimationStarted) {
      return;
    }

    if (this.currentUser) {
      // If clicking the same card that's already selected, deselect it
      if (this.selectedEstimate === point) {
        this.selectedEstimate = null;
        this.currentUser.estimate = undefined;
        this.currentUser.hasVoted = false;

        this.roomService.submitVoteSocket(this.roomId, this.currentUser.id, ''); // Send empty string to clear vote
      } else {
        // Select the new estimate
        this.selectedEstimate = point;
        this.currentUser.estimate = point;
        this.currentUser.hasVoted = true;

        // Submit vote via socket for real-time updates
        this.roomService.submitVoteSocket(this.roomId, this.currentUser.id, point.toString());
      }
    }
  }

  resetVotes(): void {
    this.selectedEstimate = null;
    this.estimationStarted = false;
    this.resultsRevealed = false;

    this.users.forEach(user => {
      user.estimate = undefined;
      user.hasVoted = false;
    });

    if (this.currentUser) {
      this.currentUser.estimate = undefined;
      this.currentUser.hasVoted = false;
      localStorage.setItem(`room_${this.roomId}_user`, JSON.stringify(this.currentUser));
    }
  }

  startEstimation(): void {
    // Use the room service to start estimation via Socket.IO
    if (this.currentUser) {
      this.roomService.startEstimationSocket(this.roomId, this.currentUser.id);
    }
    this.selectedEstimate = null;

    if (this.currentUser) {
      this.currentUser.estimate = undefined;
      this.currentUser.hasVoted = false;
    }
  }

  revealResults(): void {
    if (this.currentUser) {
      this.roomService.revealVotesSocket(this.roomId, this.currentUser.id);
    }
  }

  startNewRound(): void {
    this.estimationStarted = false;
    this.resultsRevealed = false;
    this.resetVotes();
  }

  estimateAgain(): void {
    if (this.currentUser) {
      this.roomService.resetVotingSocket(this.roomId, this.currentUser.id);
      this.selectedEstimate = null;
    }
  }

  resetAndStartEstimation(): void {
    if (this.currentUser) {
      this.roomService.resetVotingSocket(this.roomId, this.currentUser.id);
      this.selectedEstimate = null;

      setTimeout(() => {
        if (this.currentUser) {
          this.roomService.startEstimationSocket(this.roomId, this.currentUser.id);
        }
      }, 200);
    }
  }

  closeRoom(): void {
    Swal.fire({
      icon: 'warning',
      title: 'Close Room?',
      text: 'Are you sure you want to close this room? All participants will be redirected to the home page.',
      showCancelButton: true,
      confirmButtonText: 'Yes, close room',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#d33'
    }).then((result) => {
      if (result.isConfirmed && this.currentUser) {
        this.roomService.leaveRoom(this.roomId, this.currentUser.id).subscribe({
          next: () => {
            localStorage.removeItem(`room_${this.roomId}_user`);
            this.router.navigate(['/']);
          },
          error: (error) => {
            localStorage.removeItem(`room_${this.roomId}_user`);
            this.router.navigate(['/']);

            Swal.fire({
              icon: 'warning',
              title: 'Warning',
              text: 'There was an issue closing the room properly, but you have been redirected home.',
              confirmButtonText: 'OK'
            });
          }
        });
      }
    });
  }

  editStory(): void {
    this.isEditingStory = true;
    setTimeout(() => {
      const input = document.querySelector('.story-input input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  saveStory(): void {
    if (this.currentUser) {
      this.roomService.updateStorySocket(
        this.roomId,
        this.currentUser.id,
        this.storySummary,
        ''
      );
    }
    this.isEditingStory = false;
  }

  cancelEditStory(): void {
    if (this.room?.story) {
      this.storySummary = this.room.story.title || this.room.story.description || '';
    } else {
      this.storySummary = '';
    }
    this.isEditingStory = false;
  }

  isNumber(value: any): boolean {
    return !isNaN(Number(value)) && value !== null && value !== '';
  }

  isString(value: any): boolean {
    return typeof value === 'string';
  }

  getSegmentPath(segment: ChartSegment): string {
    const centerX = this.chartCenterX;
    const centerY = this.chartCenterY;
    const radius = this.chartRadius;

    const startAngle = (segment.offset / 100) * 2 * Math.PI - Math.PI / 2;
    const endAngle = ((segment.offset + segment.percentage) / 100) * 2 * Math.PI - Math.PI / 2;

    const x1 = centerX + radius * Math.cos(startAngle);
    const y1 = centerY + radius * Math.sin(startAngle);
    const x2 = centerX + radius * Math.cos(endAngle);
    const y2 = centerY + radius * Math.sin(endAngle);

    const largeArc = segment.percentage > 50 ? 1 : 0;

    const path = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return path;
  }

  get allUsersVoted(): boolean {
    // Check if at least one non-admin user has voted
    const votingUsers = this.users.filter(user => !user.isAdmin);
    return votingUsers.some(user => user.hasVoted);
  }

  get votingProgress(): string {
    const votingUsers = this.users.filter(user => !user.isAdmin);
    const votedCount = votingUsers.filter(user => user.hasVoted).length;
    return `${votedCount}/${votingUsers.length}`;
  }

  private updateChartData(): void {
    if (this.resultsRevealed) {
      this.generateChartData();
    } else {
      this.chartSegments = [];
    }
  }

  private generateChartData(): void {
    const votingUsers = this.users.filter(user => !user.isAdmin && user.hasVoted && user.estimate);
    const estimateCounts: { [key: string]: number } = {};

    votingUsers.forEach(user => {
      const estimate = user.estimate!.toString();
      estimateCounts[estimate] = (estimateCounts[estimate] || 0) + 1;
    });

    const colors = [
      '#4CAF50', // Green
      '#2196F3', // Blue
      '#FF9800', // Orange
      '#9C27B0', // Purple
      '#F44336', // Red
      '#00BCD4', // Cyan
      '#795548', // Brown
      '#607D8B', // Blue Grey
      '#FFEB3B', // Yellow
      '#E91E63'  // Pink
    ];

    let totalVotes = votingUsers.length;
    let colorIndex = 0;
    let cumulativePercentage = 0;

    this.chartSegments = Object.entries(estimateCounts).map(([estimate, count]) => {
      const percentage = (count / totalVotes) * 100;

      const centerX = this.chartCenterX;
      const centerY = this.chartCenterY;
      const radius = this.chartRadius;

      let pathData: string;

      if (percentage >= 99.9) {
        pathData = `M ${centerX} ${centerY - radius} A ${radius} ${radius} 0 1 1 ${centerX - 0.1} ${centerY - radius} Z`;
      } else {
        const startAngle = (cumulativePercentage / 100) * 2 * Math.PI - Math.PI / 2;
        const endAngle = ((cumulativePercentage + percentage) / 100) * 2 * Math.PI - Math.PI / 2;

        const x1 = centerX + radius * Math.cos(startAngle);
        const y1 = centerY + radius * Math.sin(startAngle);
        const x2 = centerX + radius * Math.cos(endAngle);
        const y2 = centerY + radius * Math.sin(endAngle);

        const largeArc = percentage > 50 ? 1 : 0;
        pathData = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      }

      const segment: ChartSegment = {
        label: this.getEstimateLabel(estimate),
        value: count,
        percentage,
        color: colors[colorIndex % colors.length],
        offset: cumulativePercentage,
        pathData: pathData
      };

      cumulativePercentage += percentage;
      colorIndex++;

      return segment;
    });

    setTimeout(() => {
      this.cdr.detectChanges();
    }, 100);
  }

  private getEstimateLabel(estimate: string): string {
    if (estimate === 'info') return '❓ Need more info';
    if (estimate === 'split') return '✂️ Story too big';
    return estimate;
  }

  private showConfetti(): void {
    const myCanvas = document.createElement('canvas');
    myCanvas.style.position = 'fixed';
    myCanvas.style.top = '0';
    myCanvas.style.left = '0';
    myCanvas.style.width = '100%';
    myCanvas.style.height = '100%';
    myCanvas.style.pointerEvents = 'none';
    myCanvas.style.zIndex = '1000';
    document.body.appendChild(myCanvas);

    const myConfetti = confetti.create(myCanvas, {
      resize: true,
      useWorker: true
    });

    // Fire from the left
    myConfetti({
      particleCount: 80,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors: ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336']
    });

    // Fire from the right
    myConfetti({
      particleCount: 80,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors: ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336']
    });

    // Center burst after a small delay
    setTimeout(() => {
      myConfetti({
        particleCount: 50,
        angle: 90,
        spread: 70,
        origin: { x: 0.5, y: 0.8 },
        colors: ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336']
      });
    }, 250);

    // Clean up after animation
    setTimeout(() => {
      document.body.removeChild(myCanvas);
    }, 3000);
  }

  copyRoomUrl(): void {
    const url = `${window.location.origin}/${this.roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      this.urlCopied = true;

      Swal.fire({
        icon: 'success',
        title: 'URL Copied!',
        text: 'Room URL has been copied to your clipboard',
        timer: 2000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });

      setTimeout(() => {
        this.urlCopied = false;
      }, 2000);
    }).catch(() => {
      Swal.fire({
        icon: 'error',
        title: 'Copy Failed',
        text: 'Unable to copy URL to clipboard. Please copy manually: ' + url,
        confirmButtonText: 'OK'
      });
    });
  }
}