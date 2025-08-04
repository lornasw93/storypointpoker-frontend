import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { RoomService } from '../core/services/room.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {

  constructor(
    private router: Router,
    private roomService: RoomService
  ) { }

  createRoom() {
    const adminName = 'Room Admin';
    const roomName = 'Story Point Poker Room';

    this.roomService.createRoom(roomName, adminName).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          localStorage.setItem(`room_${response.data.roomId}_user`, JSON.stringify({
            id: response.data.userId,
            name: adminName,
            isAdmin: true
          }));

          this.router.navigate([response.data.roomId]);
        }
      },
      error: (error) => {
        console.error('Failed to create room:', error);
        Swal.fire({
          title: 'Error',
          text: 'Failed to create room. Please try again.',
          icon: 'error',
          confirmButtonText: 'OK'
        });
      }
    });
  }
}