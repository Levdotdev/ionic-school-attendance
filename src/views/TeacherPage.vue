<template>
  <ion-page class="teacher-page">
    <portal-header portal="Teacher portal" :busy="signingOut" @logout="logout" />

    <ion-content class="teacher-content">
      <main class="dashboard-shell">
        <div v-if="approvalLoading" class="centered" role="status" aria-label="Loading teacher dashboard">
          <ion-spinner name="crescent" />
          <span>Preparing your dashboard…</span>
        </div>

        <ion-card v-else-if="!teacherApproved" class="approval-card surface-card">
          <ion-card-content>
            <div class="approval-icon" :class="{ rejected: teacherApprovalStatus === 'rejected' }" aria-hidden="true">
              {{ teacherApprovalStatus === 'rejected' ? '!' : '✓' }}
            </div>
            <p class="eyebrow">Teacher access</p>
            <h1>{{ teacherApprovalStatus === 'rejected' ? 'Registration not approved' : 'Approval pending' }}</h1>
            <ion-badge :color="teacherApprovalStatus === 'rejected' ? 'danger' : 'warning'">
              {{ teacherApprovalStatus === 'rejected' ? 'Rejected' : 'Pending review' }}
            </ion-badge>
            <p v-if="teacherApprovalStatus === 'rejected'" class="approval-copy">
              Your teacher registration was not approved. Contact the school administrator if you need the decision reviewed.
            </p>
            <p v-else class="approval-copy">
              An administrator must approve your teacher registration before you can create classes or manage attendance.
            </p>
            <p v-if="teacherApprovalNote" class="admin-note"><strong>Administrator note:</strong> {{ teacherApprovalNote }}</p>
            <div
              v-if="message"
              class="status-message approval-message"
              :class="messageKind"
              :role="messageKind === 'error' ? 'alert' : 'status'"
              aria-live="polite"
            >
              <span class="status-message-icon" aria-hidden="true">{{ messageKind === 'error' ? '!' : '✓' }}</span>
              <span>{{ message }}</span>
            </div>
            <p class="approval-live-note">This page updates automatically when the administrator reviews your registration.</p>
          </ion-card-content>
        </ion-card>

        <template v-else>
          <section class="dashboard-heading" aria-labelledby="teacher-dashboard-title">
            <div>
              <p class="eyebrow">{{ sectionMeta.eyebrow }}</p>
              <h1 id="teacher-dashboard-title">{{ sectionMeta.title }}</h1>
              <p>{{ sectionMeta.description }}</p>
            </div>
            <div v-if="activeSection !== 'overview'" class="week-chip">
              <span>{{ isCurrentSchoolWeek ? 'This school week' : 'Selected school week' }}</span>
              <strong>{{ displayDate(week.startDate) }} – {{ displayDate(week.endDateInclusive) }}</strong>
            </div>
          </section>

          <div
            v-if="message"
            class="status-message"
            :class="messageKind"
            :role="messageKind === 'error' ? 'alert' : 'status'"
            aria-live="polite"
          >
            <span class="status-message-icon" aria-hidden="true">{{ messageKind === 'error' ? '!' : '✓' }}</span>
            <span>{{ message }}</span>
          </div>

          <section v-if="visibleClasses.length && activeSection === 'attendance'" class="workspace-switcher" aria-label="Choose class">
            <ion-select v-model="selectedClassId" label="Class workspace" label-placement="stacked" fill="outline">
              <ion-select-option v-for="item in visibleClasses" :key="item.id" :value="item.id">{{ item.name }}{{ item.archived_at ? ' · Archived' : '' }}</ion-select-option>
            </ion-select>
          </section>
          <section v-if="!loadingClasses && !visibleClasses.length && activeSection === 'attendance'" class="surface-card no-classes">
            <h2>Start with your first class</h2><p>Create a class, share its join code, then add the weekly schedule.</p>
            <ion-button @click="beginClassCreate">Create class</ion-button>
          </section>

          <section v-if="activeSection === 'overview'" class="upcoming-workspace" aria-label="Current and next class schedules">
            <article v-for="item in upcoming.current" :key="item.id" class="surface-card upcoming-class current-class">
              <p class="eyebrow">Happening now</p><h2>{{ item.className }}</h2>
              <p class="upcoming-time">{{ formatScheduleOccurrence(item) }}</p>
              <p>{{ modeLabel(item.attendanceMode) }}<template v-if="item.room"> · {{ item.room }}</template></p>
              <ion-button v-if="item.meetingId" fill="outline" @click="openUpcomingClass(item)">Open attendance</ion-button>
            </article>
            <article v-if="upcoming.next" class="surface-card upcoming-class next-class">
              <p class="eyebrow">Up next</p><h2>{{ upcoming.next.className }}</h2>
              <p class="upcoming-time">{{ formatScheduleOccurrence(upcoming.next) }}</p>
              <p>{{ modeLabel(upcoming.next.attendanceMode) }}<template v-if="upcoming.next.room"> · {{ upcoming.next.room }}</template></p>
              <span class="upcoming-state">{{ upcoming.next.meetingId ? 'Scheduled class' : 'Repeats weekly' }}</span>
            </article>
            <article v-if="!upcoming.current.length && !upcoming.next" class="surface-card upcoming-class no-upcoming"><p class="eyebrow">Your schedule</p><h2>No upcoming class</h2><p>Your next active class schedule will appear here.</p></article>
          </section>

          <section v-if="activeSection === 'schedules'" class="collective-calendar" aria-label="All class schedules">
            <schedule-calendar :events="calendarEvents" :selected-date="calendarDate" @date-change="changeCalendarDate" @range-change="changeCalendarRange" @select="openCalendarEvent" />
            <p class="schedule-help">All active classes appear together. Select a meeting to manage attendance, or a weekly occurrence to edit its recurring schedule. Weekly occurrences without a generated meeting are shown as planned.</p>
          </section>

          <section v-if="activeSection === 'classes'" class="surface-card class-workspace" aria-labelledby="class-workspace-title">
            <div class="section-heading class-heading">
              <div>
                <p class="eyebrow">Class workspace</p>
                <h2 id="class-workspace-title">My classes</h2>
                <p>Manage active classes or open an archived class without losing its attendance.</p>
              </div>
              <div class="heading-actions">
                <ion-spinner v-if="loadingClasses" name="crescent" />
                <template v-else><ion-button size="small" fill="outline" @click="inviteParentOpen = true">Invite a parent</ion-button><ion-button size="small" @click="beginClassCreate">Create class</ion-button></template>
              </div>
            </div>

            <div class="class-workspace-grid single-column">
              <div class="class-selection">
                <div class="class-filters" role="group" aria-label="Class list">
                  <button type="button" :class="{ selected: classFilter === 'active' }" :aria-pressed="classFilter === 'active'" @click="classFilter = 'active'">Active <span>{{ activeClasses.length }}</span></button>
                  <button type="button" :class="{ selected: classFilter === 'archived' }" :aria-pressed="classFilter === 'archived'" @click="classFilter = 'archived'">Archived <span>{{ archivedClasses.length }}</span></button>
                </div>
                <ion-note v-if="!loadingClasses && visibleClasses.length === 0" class="empty-note">
                  {{ classFilter === 'archived' ? 'No archived classes. Archive a finished class to keep its attendance history.' : 'No active classes. Create a class to receive a student join code.' }}
                </ion-note>
                <div v-else-if="visibleClasses.length" class="select-shell">
                  <ion-select v-model="selectedClassId" label="Open class" label-placement="stacked" fill="outline">
                    <ion-select-option v-for="item in visibleClasses" :key="item.id" :value="item.id">
                      {{ item.name }} ({{ item.join_code }})
                    </ion-select-option>
                  </ion-select>
                </div>

                <div v-if="activeClass" class="active-class-summary">
                  <div class="class-avatar" aria-hidden="true">{{ activeClass.name.charAt(0).toUpperCase() }}</div>
                  <div class="class-identity">
                    <strong>{{ activeClass.name }}</strong>
                    <span>{{ activeClass.archived_at ? 'Archived class · attendance preserved' : `${students.length} enrolled students` }}</span>
                  </div>
                  <div class="join-code-block">
                    <span>Student join code</span>
                    <strong>{{ activeClass.join_code }}</strong>
                  </div>
                </div>

                <div v-if="activeClass" class="row-actions class-actions">
                  <ion-button size="small" fill="outline" :disabled="savingClass || Boolean(activeClass.archived_at)" @click="beginClassEdit(activeClass)">Edit class</ion-button>
                  <ion-button size="small" fill="outline" :disabled="savingClass" @click="setClassArchived(activeClass, !activeClass.archived_at)">{{ activeClass.archived_at ? 'Restore class' : 'Archive class' }}</ion-button>
                  <ion-button size="small" fill="outline" color="danger" :disabled="savingClass" @click="deleteClass(activeClass)">
                    Delete class
                  </ion-button>
                </div>

                <div v-if="activeClass" class="class-report-action"><div><strong>Cumulative attendance report</strong><p>All counted attendance for this class, sorted by student last name.</p></div><ion-button fill="outline" size="small" @click="reportOpen = true">PDF / CSV reports</ion-button></div>

                <div class="location-note">
                  <span class="location-pin" aria-hidden="true">⌖</span>
                  <span>School location is protected automatically within a {{ SCHOOL_RADIUS_M }}-meter boundary.</span>
                </div>
              </div>

            </div>
          </section>

          <template v-if="activeClass">
            <div v-if="activeClass.archived_at && activeSection !== 'overview'" class="archived-notice" role="status">This class is archived. Its saved attendance remains available. Restore the class to resume schedules, check-ins, and reminders.</div>

            <section v-if="activeSection === 'attendance'" class="attendance-layout">
              <article class="surface-card attendance-card" aria-labelledby="student-attendance-title">
                <div class="section-heading attendance-heading">
                  <div>
                    <p class="eyebrow">Current meeting</p>
                    <h2 id="student-attendance-title">Student attendance</h2>
                    <p v-if="selectedMeeting">{{ formatDateTime(selectedMeeting.starts_at) }} · {{ modeLabel(selectedMeeting.attendance_mode) }}</p>
                    <p v-else>Select a meeting before marking attendance.</p>
                  </div>
                  <span
                    class="status-pill"
                    :class="selectedMeeting?.attendance_enabled ? 'open' : 'closed'"
                  >
                    <span aria-hidden="true"></span>
                    {{ selectedMeeting?.attendance_enabled ? 'Attendance active' : 'Attendance inactive' }}
                  </span>
                </div>

                <div v-if="meetings.length" class="meeting-selector select-shell">
                  <ion-select v-model="selectedMeetingId" label="Meeting in selected week" label-placement="stacked" fill="outline">
                    <ion-select-option v-for="meeting in meetings" :key="meeting.id" :value="meeting.id">
                      {{ formatDateTime(meeting.starts_at) }}
                    </ion-select-option>
                  </ion-select>
                </div>
                <div v-else class="empty-state compact-empty">
                  <span aria-hidden="true">＋</span>
                  <div><strong>No meeting this week</strong><p>Add a weekly schedule or an additional meeting from Classes.</p></div>
                </div>

                <div v-if="loadingDetails || loadingAttendance" class="inline-loading" role="status">
                  <ion-spinner name="crescent" />
                  <span>{{ loadingDetails ? 'Loading students…' : 'Loading attendance…' }}</span>
                </div>
                <div v-else-if="students.length" class="student-list">
                  <div v-for="student in students" :key="student.id" class="student-row">
                    <div class="student-avatar" aria-hidden="true">{{ student.full_name.charAt(0).toUpperCase() }}</div>
                    <div class="student-copy">
                      <strong>{{ studentListName(student) }}</strong>
                      <span>{{ student.email || 'No email recorded' }}</span>
                      <button type="button" class="guardian-link-button" @click="guardianStudent = student">View linked parents</button>
                      <ion-badge
                        v-if="attendanceByStudent[student.id]"
                        :color="statusColor(attendanceByStudent[student.id].status)"
                        class="attendance-badge"
                      >
                        {{ attendanceByStudent[student.id].status }}
                      </ion-badge>
                      <small v-if="attendanceByStudent[student.id]?.source === 'self_check'" class="self-check-lock">
                        Self-check submitted {{ formatDateTime(attendanceByStudent[student.id].submitted_at || attendanceByStudent[student.id].created_at) }}
                      </small>
                    </div>
                    <div v-if="attendanceByStudent[student.id]?.source === 'self_check'" class="attendance-buttons evidence-actions">
                      <button v-if="attendanceByStudent[student.id].selfie_path" type="button" class="attendance-thumbnail" :aria-label="`View ${student.full_name}'s attendance photo`" @click="openEvidence(attendanceByStudent[student.id])"><attendance-photo :path="attendanceByStudent[student.id].selfie_path" :alt="`${student.full_name}'s attendance photo`" /></button>
                      <ion-button size="small" fill="outline" @click="openEvidence(attendanceByStudent[student.id])">View attendance</ion-button>
                    </div>
                    <div v-else class="attendance-buttons" role="group" :aria-label="`Mark attendance for ${student.full_name}`">
                      <ion-button
                        color="success"
                        size="small"
                        :aria-label="`Mark ${student.full_name} present`"
                        :aria-pressed="attendanceByStudent[student.id]?.status === 'present'"
                        :fill="attendanceByStudent[student.id]?.status === 'present' ? 'solid' : 'outline'"
                        :disabled="!canMarkAttendance || Boolean(markingStudentId) || attendanceByStudent[student.id]?.source === 'self_check'"
                        @click="markAttendance(student.id, 'present')"
                      >
                        Present
                      </ion-button>
                      <ion-button
                        color="danger"
                        size="small"
                        :aria-label="`Mark ${student.full_name} absent`"
                        :aria-pressed="attendanceByStudent[student.id]?.status === 'absent'"
                        :fill="attendanceByStudent[student.id]?.status === 'absent' ? 'solid' : 'outline'"
                        :disabled="!canMarkAttendance || Boolean(markingStudentId) || attendanceByStudent[student.id]?.source === 'self_check'"
                        @click="markAttendance(student.id, 'absent')"
                      >
                        Absent
                      </ion-button>
                    </div>
                  </div>
                </div>
                <div v-else class="empty-state">
                  <span aria-hidden="true">◎</span>
                  <div><strong>No enrolled students</strong><p>Students will appear here after joining this class.</p></div>
                </div>
              </article>

              <aside class="attendance-side">
                <section class="surface-card meeting-control" aria-labelledby="meeting-control-title">
                  <div class="section-heading">
                    <div><p class="eyebrow">Meeting control</p><h2 id="meeting-control-title">Attendance status</h2></div>
                  </div>
                  <template v-if="selectedMeeting">
                    <div class="badge-row">
                      <ion-badge :color="selectedMeeting.attendance_enabled ? 'success' : 'medium'">
                        {{ selectedMeeting.attendance_enabled ? 'Counts' : 'Does not count' }}
                      </ion-badge>
                      <ion-badge color="tertiary">{{ modeLabel(selectedMeeting.attendance_mode) }}</ion-badge>
                      <ion-badge v-if="selectedMeeting.schedule_id" color="primary">Weekly</ion-badge>
                    </div>
                    <div class="meeting-detail">
                      <strong>{{ activeClass.name }}</strong>
                      <span>Check-in: {{ formatDateTime(selectedMeeting.attendance_opens_at) }}</span>
                      <span>Closes: {{ formatDateTime(selectedMeeting.attendance_closes_at) }}</span>
                    </div>
                    <ion-button
                      class="full-button"
                      :color="selectedMeeting.attendance_enabled ? 'warning' : 'success'"
                      fill="outline"
                      :disabled="updatingMeeting || Boolean(activeClass.archived_at)"
                      @click="toggleAttendance(selectedMeeting)"
                    >
                      {{ selectedMeeting.attendance_enabled ? 'Do not count this meeting' : 'Count this meeting' }}
                    </ion-button>
                    <div class="row-actions meeting-edit-actions">
                      <ion-button size="small" fill="outline" :disabled="updatingMeeting || Boolean(activeClass.archived_at)" @click="beginMeetingEdit(selectedMeeting)">
                        Edit meeting
                      </ion-button>
                      <ion-button size="small" fill="outline" color="danger" :disabled="updatingMeeting" @click="deleteMeeting(selectedMeeting)">
                        Delete
                      </ion-button>
                    </div>
                  </template>
                  <p v-else class="muted-copy">Create or select a meeting to manage whether attendance counts.</p>
                </section>

                <section class="surface-card week-overview" aria-labelledby="week-overview-title">
                  <div class="section-heading">
                    <div><p class="eyebrow">{{ isCurrentSchoolWeek ? 'This week' : 'Selected week' }}</p><h2 id="week-overview-title">Meeting overview</h2></div>
                    <span class="count-bubble">{{ meetings.length }}</span>
                  </div>
                  <div v-if="meetings.length" class="mini-meeting-list">
                    <button
                      v-for="meeting in meetings"
                      :key="meeting.id"
                      type="button"
                      class="mini-meeting"
                      :class="{ selected: meeting.id === selectedMeetingId }"
                      :aria-pressed="meeting.id === selectedMeetingId"
                      :aria-current="meeting.id === selectedMeetingId ? 'true' : undefined"
                      @click="selectedMeetingId = meeting.id"
                    >
                      <span class="mini-date">{{ formatDateTime(meeting.starts_at).split(',')[0] }}</span>
                      <span><strong>{{ formatDateTime(meeting.starts_at) }}</strong><small>{{ modeLabel(meeting.attendance_mode) }}</small></span>
                    </button>
                  </div>
                  <p v-else class="muted-copy">No meetings are scheduled for this week.</p>
                </section>
              </aside>
            </section>

            <section v-if="activeSection === 'classes'" class="planning-section" aria-labelledby="planning-title">
              <div class="planning-heading">
                <div><p class="eyebrow">Planning & management</p><h2 id="planning-title">Set up your class week</h2></div>
                <p>Weekly schedules create meetings automatically. Manage the selected week’s class and meeting exceptions below.</p>
              </div>

              <div class="planning-grid">
                <article class="surface-card schedule-card" aria-labelledby="weekly-schedule-title">
                  <div class="section-heading">
                    <div><p class="eyebrow">Repeats every week</p><h2 id="weekly-schedule-title">Weekly schedule</h2></div>
                    <div class="heading-actions">
                      <span class="count-bubble">{{ schedules.length }}</span>
                      <ion-button size="small" :disabled="Boolean(activeClass.archived_at)" @click="beginScheduleCreate">Add schedule</ion-button>
                    </div>
                  </div>
                  <p class="section-description">Each active schedule automatically creates one meeting for this week.</p>

                  <div v-if="schedules.length" class="schedule-list">
                    <div v-for="schedule in schedules" :key="schedule.id" class="schedule-row">
                      <span class="schedule-day">{{ dayLabel(schedule.day_of_week).slice(0, 3) }}</span>
                      <div class="schedule-copy">
                        <strong>{{ dayLabel(schedule.day_of_week) }} · {{ scheduleDateLabel(schedule.day_of_week) }}</strong>
                        <span>{{ formatTime(schedule.starts_at) }} – {{ formatTime(schedule.ends_at) }}<template v-if="schedule.room"> · {{ schedule.room }}</template></span>
                        <span>{{ modeLabel(schedule.attendance_mode) }}</span>
                        <span>Check-in {{ scheduleCheckInWindow(schedule) }}</span>
                        <ion-badge v-if="!schedule.is_active" color="medium">Inactive</ion-badge>
                      </div>
                      <div class="item-actions">
                        <ion-button size="small" fill="outline" :disabled="Boolean(activeClass.archived_at)" @click="beginScheduleEdit(schedule)">Edit</ion-button>
                        <ion-button size="small" fill="outline" color="danger" :disabled="Boolean(activeClass.archived_at)" @click="deleteSchedule(schedule)">Delete</ion-button>
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-state compact-empty"><span aria-hidden="true">↻</span><div><strong>No weekly schedule</strong><p>Add the class’s regular day and time.</p></div></div>
                </article>

                <article class="surface-card meeting-form-card" aria-labelledby="meeting-form-title">
                  <div class="section-heading">
                    <div>
                      <p class="eyebrow">One-time adjustment</p>
                      <h2 id="meeting-form-title">Additional meeting</h2>
                    </div>
                  </div>
                  <p class="section-description">Use this for events, online classes, or a meeting outside the regular schedule.</p>

                  <div class="meeting-callout">
                    <span>Create a meeting in the selected school week, then manage it from Attendance or the calendar.</span>
                    <div class="location-note full-row">
                      <span class="location-pin" aria-hidden="true">⌖</span>
                      <span>On-site checks use the {{ SCHOOL_RADIUS_M }}-meter school boundary. Online check-in locations are shared only with linked parents.</span>
                    </div>
                    <ion-button :disabled="Boolean(activeClass.archived_at)" @click="beginMeetingCreate">Create meeting</ion-button>
                  </div>
                </article>
              </div>
            </section>

          </template>
        </template>
      </main>
    </ion-content>

    <evidence-detail-modal :record="selectedEvidence" :student-name="selectedEvidence ? studentName(selectedEvidence.student_id) : ''" reviewable :busy="Boolean(reviewingRecordId)" :action-error="evidenceError" @close="closeEvidence" @review="reviewSelectedEvidence" />
    <student-guardian-modal :student="guardianStudent" @close="guardianStudent = null" @invite="guardianStudent = null; inviteParentOpen = true" />
    <invite-parent-modal :open="inviteParentOpen" @close="inviteParentOpen = false" />
    <class-attendance-report-modal :open="reportOpen" :class-id="activeClass?.id || ''" @close="reportOpen = false" />

    <app-modal :open="classModalOpen" :title="editingClassId ? 'Edit class' : 'Create class'" :busy="savingClass" @close="cancelClassEdit">
        <form class="modal-form" @submit.prevent="saveClass">
          <div class="form-heading">
            <strong>{{ editingClassId ? 'Class details' : 'Create a new class' }}</strong>
            <span>{{ editingClassId ? 'Update the class name.' : 'A secure student join code is generated automatically.' }}</span>
          </div>
          <div v-if="message && messageKind === 'error'" class="status-message error" role="alert">
            <span class="status-message-icon" aria-hidden="true">!</span>
            <span>{{ message }}</span>
          </div>
          <ion-input v-model="classForm.name" label="Class name" label-placement="stacked" fill="outline" :disabled="savingClass" required />
          <ion-button type="submit" expand="block" :disabled="savingClass">
            <ion-spinner v-if="savingClass" name="crescent" />
            <span v-else>{{ editingClassId ? 'Save changes' : 'Create class' }}</span>
          </ion-button>
        </form>
    </app-modal>

    <app-modal :open="scheduleModalOpen" :title="editingScheduleId ? 'Edit weekly schedule' : 'Add weekly schedule'" :busy="savingSchedule" @close="cancelScheduleEdit">
        <form class="modal-form form-grid" @submit.prevent="saveSchedule">
          <div v-if="message && messageKind === 'error'" class="status-message error full-row" role="alert">
            <span class="status-message-icon" aria-hidden="true">!</span>
            <span>{{ message }}</span>
          </div>
          <ion-select v-model="scheduleForm.day_of_week" label="Day" label-placement="stacked" fill="outline" :disabled="savingSchedule">
            <ion-select-option v-for="day in weekdays" :key="day.value" :value="day.value">{{ day.label }}</ion-select-option>
          </ion-select>
          <ion-input v-model="scheduleForm.starts_at" label="Starts" label-placement="stacked" fill="outline" type="time" :disabled="savingSchedule" required />
          <ion-input v-model="scheduleForm.ends_at" label="Ends" label-placement="stacked" fill="outline" type="time" :disabled="savingSchedule" required />
          <ion-input v-model="scheduleForm.room" label="Room (optional)" label-placement="stacked" fill="outline" :disabled="savingSchedule" />
          <ion-select v-model="scheduleForm.attendance_mode" class="full-row" label="Default attendance mode" label-placement="stacked" fill="outline" :disabled="savingSchedule">
            <ion-select-option value="teacher_manual">Teacher marks attendance</ion-select-option>
            <ion-select-option value="self_on_site">Student self-check on site</ion-select-option>
            <ion-select-option value="self_online">Online class self-check</ion-select-option>
          </ion-select>
          <ion-input v-model="scheduleForm.check_in_minutes_after_start" type="number" min="1" max="1440" step="1" label="Close check-in minutes after class starts" label-placement="stacked" fill="outline" placeholder="Leave blank for class end" :disabled="savingSchedule" />
          <p class="schedule-help full-row">Check-in starts exactly when class starts: {{ scheduleCheckInWindow(scheduleForm) }}. Leave the closing field empty to close at class end. Teachers may mark attendance outside this self-check window.</p>
          <div class="notification-note full-row">
            <strong>Automatic class reminders</strong>
            <span>You receive reminders 5 minutes before and at class time. Students choose which reminder times they want for each schedule.</span>
          </div>
          <ion-button class="full-row" type="submit" expand="block" :disabled="savingSchedule">
            <ion-spinner v-if="savingSchedule" name="crescent" />
            <span v-else>{{ editingScheduleId ? 'Save schedule' : 'Add schedule' }}</span>
          </ion-button>
        </form>
    </app-modal>

    <app-modal :open="meetingModalOpen" :title="editingMeetingId ? 'Edit meeting' : 'Create meeting'" :busy="savingMeeting" wide @close="cancelMeetingEdit">
        <form class="modal-form form-grid" @submit.prevent="saveMeeting">
          <div v-if="message && messageKind === 'error'" class="status-message error full-row" role="alert">
            <span class="status-message-icon" aria-hidden="true">!</span>
            <span>{{ message }}</span>
          </div>
          <ion-select v-model="meetingForm.mode" label="Attendance mode" label-placement="stacked" fill="outline" :disabled="savingMeeting">
            <ion-select-option value="teacher_manual">Teacher marks attendance</ion-select-option>
            <ion-select-option value="self_on_site">Student self-check on site</ion-select-option>
            <ion-select-option value="self_online">Online class self-check</ion-select-option>
          </ion-select>
          <label class="native-field"><span>Meeting starts</span><day-date-input v-model="meetingForm.starts_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" :disabled="savingMeeting" required /></label>
          <label class="native-field"><span>Meeting ends</span><day-date-input v-model="meetingForm.ends_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" :disabled="savingMeeting" required /></label>
          <label class="native-field"><span>Check-in closes</span><day-date-input v-model="meetingForm.check_in_closes_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" :disabled="savingMeeting" required /></label>
          <div class="location-note full-row">
            <span class="location-pin" aria-hidden="true">⌖</span>
            <span>On-site checks use the {{ SCHOOL_RADIUS_M }}-meter school boundary. Online check-in locations are shared only with linked parents.</span>
          </div>
          <ion-button class="full-row" type="submit" expand="block" :disabled="savingMeeting">
            <ion-spinner v-if="savingMeeting" name="crescent" />
            <span v-else>{{ editingMeetingId ? 'Save meeting' : 'Create meeting' }}</span>
          </ion-button>
        </form>
    </app-modal>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonInput,
  IonMenuButton,
  IonModal,
  IonNote,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
  IonToggle,
  alertController,
  onIonViewWillEnter,
} from '@ionic/vue'
import { useSession } from '@/composables/useSession'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { supabase } from '@/lib/supabase'
import { toUserFacingErrorMessage } from '@/utils/errors'
import PortalHeader from '@/components/PortalHeader.vue'
import AppModal from '@/components/AppModal.vue'
import EvidenceDetailModal from '@/components/EvidenceDetailModal.vue'
import ScheduleCalendar, { type CalendarEvent } from '@/components/ScheduleCalendar.vue'
import DayDateInput from '@/components/DayDateInput.vue'
import StudentGuardianModal from '@/components/StudentGuardianModal.vue'
import InviteParentModal from '@/components/InviteParentModal.vue'
import AttendancePhoto from '@/components/AttendancePhoto.vue'
import ClassAttendanceReportModal from '@/components/ClassAttendanceReportModal.vue'
import { teacherUpcomingSchedules, type UpcomingTeacherClass } from '@/utils/teacherUpcomingSchedules'

type MeetingMode = 'teacher_manual' | 'self_on_site' | 'self_online'
type AttendanceStatus = 'present' | 'absent'
type VerificationStatus = 'pending' | 'approved' | 'rejected'
type TeacherSection = 'overview' | 'classes' | 'attendance' | 'schedules'

interface ClassRow {
  id: string
  teacher_id: string
  join_code: string
  name: string
  section: string | null
  archived_at?: string | null
  timezone: string
  default_latitude: number | null
  default_longitude: number | null
  default_radius_m: number
  default_max_accuracy_m: number
}

interface ScheduleRow {
  id: string
  class_id: string
  day_of_week: number
  starts_at: string
  ends_at: string
  room: string | null
  is_active: boolean
  attendance_mode: MeetingMode
  check_in_minutes_after_start: number | null
}

interface MeetingRow {
  id: string
  class_id: string
  schedule_id: string | null
  starts_at: string
  ends_at: string
  attendance_mode: MeetingMode
  attendance_enabled: boolean
  attendance_opens_at: string
  attendance_closes_at: string
  latitude: number | null
  longitude: number | null
  radius_m: number | null
  max_accuracy_m: number | null
}

interface StudentRow {
  id: string
  first_name?: string
  last_name?: string
  full_name: string
  email: string | null
}

interface AttendanceRow {
  id: string
  meeting_id: string
  student_id: string
  status: AttendanceStatus
  source: string
  selfie_path: string | null
  selfie_url?: string | null
  latitude: number | null
  longitude: number | null
  distance_m: number | null
  verification_status: VerificationStatus | null
  teacher_note: string | null
  review_note: string | null
  submitted_at: string | null
  created_at: string
}

interface TeacherCalendarEvent extends CalendarEvent {
  classId: string
  scheduleId?: string
  meetingId?: string
}

const SCHOOL_LATITUDE = 13.387419
const SCHOOL_LONGITUDE = 121.162494
const SCHOOL_RADIUS_M = 180
const MANILA_TIME_ZONE = 'Asia/Manila'
const MEETING_COLUMNS = 'id,class_id,schedule_id,starts_at,ends_at,attendance_mode,attendance_enabled,attendance_opens_at,attendance_closes_at,latitude,longitude,radius_m,max_accuracy_m'

const weekdays = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

const router = useRouter()
const route = useRoute()
const { initializeSession, refreshProfile, profile, signOut } = useSession()
const classes = ref<ClassRow[]>([])
const classFilter = ref<'active' | 'archived'>('active')
const activeClasses = computed(() => classes.value.filter(item => !item.archived_at))
const archivedClasses = computed(() => classes.value.filter(item => Boolean(item.archived_at)))
const visibleClasses = computed(() => classFilter.value === 'archived' ? archivedClasses.value : activeClasses.value)
const schedules = ref<ScheduleRow[]>([])
const calendarSchedules = ref<ScheduleRow[]>([])
const calendarMeetings = ref<MeetingRow[]>([])
const calendarExceptions = ref<Array<{ schedule_id: string; schedule_week_start: string }>>([])
const upcomingMeetings = ref<MeetingRow[]>([])
const upcomingExceptions = ref<Array<{ schedule_id: string; schedule_week_start: string }>>([])
const upcomingNow = ref(Date.now())
const meetings = ref<MeetingRow[]>([])
const students = ref<StudentRow[]>([])
const attendanceRecords = ref<AttendanceRow[]>([])
const selectedClassId = ref('')
const selectedMeetingId = ref('')
const editingClassId = ref('')
const editingScheduleId = ref('')
const editingMeetingId = ref('')
const classModalOpen = ref(false)
const scheduleModalOpen = ref(false)
const meetingModalOpen = ref(false)
const approvalLoading = ref(true)
const loadingClasses = ref(true)
const loadingDetails = ref(false)
const loadingAttendance = ref(false)
let classDetailsRequest = 0
let attendanceRequest = 0
const savingClass = ref(false)
const savingSchedule = ref(false)
const savingMeeting = ref(false)
const updatingMeeting = ref(false)
const markingStudentId = ref('')
const reviewingRecordId = ref('')
const selectedEvidence = ref<(AttendanceRow & { meeting_starts_at?: string; class_name?: string; attendance_enabled?: boolean; location_status?: string }) | null>(null)
const guardianStudent = ref<StudentRow | null>(null), inviteParentOpen = ref(false)
const reportOpen = ref(false)
const evidenceError = ref('')
const signingOut = ref(false)
const message = ref('')
const messageKind = ref<'success' | 'error'>('success')
let feedbackTimeout: ReturnType<typeof setTimeout> | undefined
watch(message, value => { clearTimeout(feedbackTimeout); if (value) feedbackTimeout = setTimeout(clearMessage, 5000) })
watch(() => route.query.section, clearMessage)
onBeforeUnmount(() => { clearTimeout(feedbackTimeout); classDetailsRequest++; attendanceRequest++; calendarRequest++ })

const week = reactive(currentManilaWeek())
const calendarDate = ref(dateKeyInManila(new Date()))
const calendarRange = ref({ start: week.startDate, end: dateKeyInManila(new Date(week.endIso)) })
const isCurrentSchoolWeek = computed(() => week.startDate === currentManilaWeek().startDate)
const meetingInputMin = computed(() => `${week.startDate}T00:00`)
const meetingInputMax = computed(() => `${week.endDateInclusive}T23:59`)
let calendarRequest = 0

const classForm = reactive({ name: '' })
const scheduleForm = reactive({ day_of_week: 1, starts_at: '08:00', ends_at: '09:00', room: '', attendance_mode: 'teacher_manual' as MeetingMode, check_in_minutes_after_start: '' as number | string, is_active: true })
const meetingForm = reactive({
  mode: 'teacher_manual' as MeetingMode,
  starts_at: '',
  ends_at: '',
  check_in_closes_at: '',
})

const activeClass = computed(() => classes.value.find((item) => item.id === selectedClassId.value) ?? null)
const upcoming = computed(() => teacherUpcomingSchedules({ courses: activeClasses.value, schedules: calendarSchedules.value, meetings: upcomingMeetings.value, exceptions: upcomingExceptions.value, now: new Date(upcomingNow.value) }))
const calendarEvents = computed<TeacherCalendarEvent[]>(() => {
  const classMap = new Map(activeClasses.value.map(item => [item.id, item]))
  const events: TeacherCalendarEvent[] = []
  const actualOccurrences = new Set<string>()
  const excludedOccurrences = new Set(calendarExceptions.value.map(exception => `${exception.schedule_id}:${exception.schedule_week_start}`))
  for (const meeting of calendarMeetings.value) {
    const schoolClass = classMap.get(meeting.class_id)
    if (!schoolClass) continue
    if (meeting.schedule_id) actualOccurrences.add(`${meeting.schedule_id}:${dateKeyInManila(new Date(meeting.starts_at))}`)
    events.push({ id: `meeting:${meeting.id}`, title: schoolClass.name, start: meeting.starts_at, end: meeting.ends_at, kind: 'meeting', className: schoolClass.name, status: meeting.attendance_enabled ? 'active' : 'not_counted', subtext: modeLabel(meeting.attendance_mode), classId: meeting.class_id, meetingId: meeting.id })
  }
  for (let day = calendarRange.value.start; day < calendarRange.value.end; day = addCalendarDays(day, 1)) {
    const dayOfWeek = new Date(`${day}T00:00:00Z`).getUTCDay()
    for (const schedule of calendarSchedules.value) {
      const schoolClass = classMap.get(schedule.class_id)
      if (!schoolClass || !schedule.is_active || schedule.day_of_week !== dayOfWeek || actualOccurrences.has(`${schedule.id}:${day}`) || excludedOccurrences.has(`${schedule.id}:${currentManilaWeek(new Date(`${day}T12:00:00+08:00`)).startDate}`)) continue
      events.push({ id: `weekly:${schedule.id}:${day}`, title: schoolClass.name, start: manilaInputToIso(`${day}T${schedule.starts_at.slice(0, 5)}`), end: manilaInputToIso(`${day}T${schedule.ends_at.slice(0, 5)}`), kind: 'weekly', className: schoolClass.name, status: 'planned', subtext: schedule.room ? `${schedule.room} · Planned` : 'Planned weekly class', classId: schoolClass.id, scheduleId: schedule.id })
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start))
})
const selectedMeeting = computed(() => meetings.value.find((item) => item.id === selectedMeetingId.value) ?? null)
const attendanceByStudent = computed<Record<string, AttendanceRow>>(() =>
  Object.fromEntries(attendanceRecords.value.map((record) => [record.student_id, record])),
)
const evidenceRows = computed(() => attendanceRecords.value.filter((record) => record.source === 'self_check'))
const countedMeetings = computed(() => meetings.value.filter(meeting => meeting.attendance_enabled).length)
const presentCount = computed(
  () =>
    attendanceRecords.value.filter(
      (record) =>
        record.status === 'present' &&
        (record.verification_status == null || record.verification_status === 'approved'),
    ).length,
)
const absentCount = computed(() => attendanceRecords.value.filter((record) => record.status === 'absent').length)
const uncheckedCount = computed(() => Math.max(students.value.length - attendanceRecords.value.length, 0))
const voidedEvidenceCount = computed(
  () => evidenceRows.value.filter((record) => record.verification_status === 'rejected').length,
)
const canMarkAttendance = computed(
  () => Boolean(!activeClass.value?.archived_at && !loadingDetails.value && !loadingAttendance.value && selectedMeeting.value?.attendance_enabled),
)
const teacherApproved = computed(
  () => profile.value?.role === 'teacher' && profile.value.teacher_approval_status === 'approved',
)
const teacherApprovalStatus = computed(() =>
  profile.value?.teacher_approval_status === 'rejected' ? 'rejected' : 'pending',
)
const teacherApprovalNote = computed(() => profile.value?.teacher_approval_note?.trim() || '')
const currentWeekLabel = computed(() => `This week: ${displayDate(week.startDate)} to ${displayDate(week.endDateInclusive)}`)
const activeSection = computed<TeacherSection>(() => {
  const value = typeof route.query.section === 'string' ? route.query.section : 'overview'
  if (value === 'evidence') return 'attendance'
  return value === 'classes' || value === 'attendance' || value === 'schedules' ? value : 'overview'
})
const sectionMeta = computed(() => {
  const sections: Record<TeacherSection, { eyebrow: string; title: string; description: string }> = {
    overview: {
    eyebrow: 'Teacher dashboard',
    title: `Welcome back, ${profile.value?.full_name || 'Teacher'}`,
    description: 'Your current class and the next schedule across all your subjects.',
    },
    classes: {
    eyebrow: 'Class management',
    title: 'Classes and enrollment codes',
    description: 'Manage classes, weekly schedules, additional meetings, and cumulative attendance reports.',
    },
    attendance: {
    eyebrow: 'Attendance',
    title: 'Class attendance',
    description: 'Mark students present or absent, view submitted photos, and review self-check attendance.',
    },
    schedules: {
    eyebrow: 'Weekly planning',
    title: 'My calendar',
    description: 'See every active class together. Manage recurring schedules and additional meetings from Classes.',
    },
  }
  return sections[activeSection.value]
})

watch(classFilter, () => {
  if (!visibleClasses.value.some(item => item.id === selectedClassId.value)) {
    selectedClassId.value = visibleClasses.value[0]?.id ?? ''
  }
})

useRealtimeRefresh({
  channel: 'teacher-workspace',
  enabled: () => profile.value?.role === 'teacher' && !approvalLoading.value,
  onChange: refreshTeacherWorkspace,
})

watch(selectedClassId, async (classId) => {
  reportOpen.value = false
  closeEvidence()
  if (editingClassId.value && editingClassId.value !== classId) cancelClassEdit()
  cancelScheduleEdit()
  cancelMeetingEdit()
  clearClassDetails()
  if (classId) await loadClassDetails(classId)
  else loadingDetails.value = false
})

watch(selectedMeetingId, async (meetingId) => {
  closeEvidence()
  if (meetingId) await loadAttendance(meetingId)
  else attendanceRecords.value = []
})

onMounted(async () => {
  await initializeSession()
  await checkApprovalStatus()
})

onIonViewWillEnter(async () => {
  if (approvalLoading.value || loadingDetails.value || signingOut.value || classModalOpen.value || scheduleModalOpen.value || meetingModalOpen.value || selectedEvidence.value || markingStudentId.value || updatingMeeting.value || reviewingRecordId.value) return
  const previousClassId = selectedClassId.value
  await checkApprovalStatus()
  // A new selection refreshes through its watcher. An existing selection
  // needs an explicit refresh because Ionic keeps this page mounted.
  if (teacherApproved.value && previousClassId && selectedClassId.value === previousClassId) await loadClassDetails(previousClassId)
})

async function checkApprovalStatus() {
  approvalLoading.value = true
  clearMessage()
  try {
    const currentProfile = await refreshProfile()
    if (!currentProfile) throw new Error('Unable to load your teacher registration.')

    if (currentProfile.role === 'teacher' && currentProfile.teacher_approval_status === 'approved') {
      await loadClasses()
    } else {
      loadingClasses.value = false
    }
  } catch (error) {
    loadingClasses.value = false
    showError(error)
  } finally {
    approvalLoading.value = false
  }
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('Please sign in as a teacher.')
  return data.user.id
}

async function refreshTeacherWorkspace() {
  const currentProfile = await refreshProfile()
  if (currentProfile?.role !== 'teacher' || currentProfile.teacher_approval_status !== 'approved') return
  const previousClassId = selectedClassId.value
  await loadClasses(true)
  if (previousClassId && selectedClassId.value === previousClassId) await loadClassDetails(previousClassId, { generate: false, silent: true })
}

function dateKeyInManila(date: Date) {
  const parts = datePartsInManila(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function addCalendarDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return dateKey(date)
}

function changeCalendarRange(range: { start: string; end: string }) {
  calendarRange.value = range
  void loadCalendar()
}

async function changeCalendarDate(day: string) {
  calendarDate.value = day
  const nextWeek = currentManilaWeek(new Date(`${day}T12:00:00+08:00`))
  if (week.startDate === nextWeek.startDate) return
  Object.assign(week, nextWeek)
  if (selectedClassId.value) await loadClassDetails(selectedClassId.value, { generate: isCurrentSchoolWeek.value, silent: true })
}

async function loadCalendar() {
  const request = ++calendarRequest
  upcomingNow.value = Date.now()
  const classIds = activeClasses.value.map(item => item.id)
  if (!classIds.length) {
    calendarSchedules.value = []
    calendarMeetings.value = []
    calendarExceptions.value = []
    upcomingMeetings.value = []
    upcomingExceptions.value = []
    return
  }
  const range = calendarRange.value
  const today = dateKeyInManila(new Date(upcomingNow.value))
  try {
    const [scheduleResult, meetingResult, exceptionResult, upcomingResult, upcomingExceptionResult] = await Promise.all([
      supabase.from('class_schedules').select('*').in('class_id', classIds),
      supabase.from('meetings').select(MEETING_COLUMNS).in('class_id', classIds).gte('starts_at', `${range.start}T00:00:00+08:00`).lt('starts_at', `${range.end}T00:00:00+08:00`).order('starts_at'),
      supabase.rpc('visible_schedule_meeting_exceptions', { p_start: range.start, p_end: range.end }),
      supabase.from('meetings').select(MEETING_COLUMNS).in('class_id', classIds).gte('ends_at', new Date(upcomingNow.value).toISOString()).order('starts_at'),
      supabase.rpc('visible_schedule_meeting_exceptions', { p_start: today, p_end: addCalendarDays(today, 8) }),
    ])
    if (request !== calendarRequest) return
    if (scheduleResult.error) throw scheduleResult.error
    if (meetingResult.error) throw meetingResult.error
    if (exceptionResult.error) throw exceptionResult.error
    if (upcomingResult.error) throw upcomingResult.error
    if (upcomingExceptionResult.error) throw upcomingExceptionResult.error
    calendarSchedules.value = ((scheduleResult.data ?? []) as ScheduleRow[]).filter(schedule => classIds.includes(schedule.class_id))
    calendarMeetings.value = ((meetingResult.data ?? []) as MeetingRow[]).filter(meeting => classIds.includes(meeting.class_id))
    calendarExceptions.value = Array.isArray(exceptionResult.data) ? exceptionResult.data : []
    upcomingMeetings.value = ((upcomingResult.data ?? []) as MeetingRow[]).filter(meeting => classIds.includes(meeting.class_id))
    upcomingExceptions.value = Array.isArray(upcomingExceptionResult.data) ? upcomingExceptionResult.data : []
  } catch (error) {
    if (request === calendarRequest) showError(error)
  }
}

async function openCalendarEvent(event: CalendarEvent) {
  const selected = calendarEvents.value.find(item => item.id === event.id)
  if (!selected) return
  classFilter.value = 'active'
  calendarDate.value = dateKeyInManila(new Date(selected.start))
  Object.assign(week, currentManilaWeek(new Date(selected.start)))
  selectedClassId.value = selected.classId
  await nextTick()
  await loadClassDetails(selected.classId, { generate: isCurrentSchoolWeek.value })
  if (selected.meetingId) {
    selectedMeetingId.value = selected.meetingId
    await router.push({ path: '/teacher', query: { section: 'attendance' } })
  } else if (selected.scheduleId) {
    const schedule = schedules.value.find(item => item.id === selected.scheduleId)
    if (schedule) {
      await router.push({ path: '/teacher', query: { section: 'classes' } })
      beginScheduleEdit(schedule)
    }
  }
}

function formatScheduleOccurrence(item: UpcomingTeacherClass) {
  const start = new Intl.DateTimeFormat('en-PH', { timeZone: MANILA_TIME_ZONE, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.start))
  const end = new Intl.DateTimeFormat('en-PH', { timeZone: MANILA_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(item.end))
  return `${start} - ${end}`
}
async function openUpcomingClass(item: UpcomingTeacherClass) {
  classFilter.value = 'active'
  calendarDate.value = dateKeyInManila(new Date(item.start))
  Object.assign(week, currentManilaWeek(new Date(item.start)))
  selectedClassId.value = item.classId
  await nextTick()
  await loadClassDetails(item.classId)
  if (item.meetingId) selectedMeetingId.value = item.meetingId
  await router.push({ path: '/teacher', query: { section: 'attendance' } })
}

async function loadClasses(silent = false) {
  if (!silent) loadingClasses.value = true
  try {
    const teacherId = await currentUserId()
    const { data, error } = await supabase
      .from('classes')
      .select('id,teacher_id,join_code,name,section,archived_at,timezone,default_latitude,default_longitude,default_radius_m,default_max_accuracy_m')
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false })
    if (error) throw error

    classes.value = (data ?? []) as ClassRow[]
    if (!visibleClasses.value.some((item) => item.id === selectedClassId.value)) {
      selectedClassId.value = visibleClasses.value[0]?.id ?? ''
    }
    await loadCalendar()
  } catch (error) {
    showError(error)
  } finally {
    loadingClasses.value = false
  }
}

async function saveClass() {
  savingClass.value = true
  let saved = false
  clearMessage()
  try {
    const name = classForm.name.trim()
    if (!name) throw new Error('Enter a class name.')

    if (editingClassId.value) {
      const { data, error } = await supabase
        .from('classes')
        .update({
          name,
          timezone: MANILA_TIME_ZONE,
        })
        .eq('id', editingClassId.value)
        .select('id,teacher_id,join_code,name,section,archived_at,timezone,default_latitude,default_longitude,default_radius_m,default_max_accuracy_m')
        .single()
      if (error) throw error
      const index = classes.value.findIndex((item) => item.id === data.id)
      if (index >= 0) classes.value[index] = data as ClassRow
      saved = true
      showSuccess('Class updated.')
      return
    }

    const { data, error } = await supabase.rpc('create_class', {
      p_name: name,
      p_section: null,
      p_timezone: MANILA_TIME_ZONE,
    })
    if (error) throw error
    const created = (Array.isArray(data) ? data[0] : data) as ClassRow | null
    classFilter.value = 'active'
    await loadClasses()
    if (created?.id) selectedClassId.value = created.id
    saved = true
    showSuccess(
      created?.join_code
        ? `Class created. Students can join with code ${created.join_code}.`
        : 'Class created. Its join code is shown in the class list.',
    )
  } catch (error) {
    showError(error)
  } finally {
    savingClass.value = false
    if (saved) cancelClassEdit()
  }
}

function beginClassCreate() {
  editingClassId.value = ''
  resetClassForm()
  clearMessage()
  classModalOpen.value = true
}

function beginClassEdit(item: ClassRow) {
  editingClassId.value = item.id
  classForm.name = item.name
  clearMessage()
  classModalOpen.value = true
}

function cancelClassEdit() {
  classModalOpen.value = false
  editingClassId.value = ''
  resetClassForm()
}

function resetClassForm() {
  classForm.name = ''
}

async function setClassArchived(item: ClassRow, archived: boolean) {
  const confirmed = await confirmAction({
    header: archived ? 'Archive class?' : 'Restore class?',
    message: archived
      ? 'Attendance and enrollment history stay saved. New check-ins, generated meetings, and reminders stop until you restore the class.'
      : 'The class becomes active again and resumes weekly meetings, check-ins, and reminders.',
    confirmText: archived ? 'Archive class' : 'Restore class',
  })
  if (!confirmed) return
  savingClass.value = true
  clearMessage()
  try {
    const { error } = await supabase.rpc('set_class_archived', { p_class_id: item.id, p_archived: archived })
    if (error) throw error
    item.archived_at = archived ? new Date().toISOString() : null
    classFilter.value = archived ? 'archived' : 'active'
    selectedClassId.value = item.id
    await loadClasses(true)
    showSuccess(archived ? 'Class archived. Its attendance history is preserved.' : 'Class restored.')
  } catch (error) {
    showError(error)
  } finally {
    savingClass.value = false
  }
}

async function deleteClass(item: ClassRow) {
  const confirmed = await confirmAction({
    header: 'Delete class?',
    message: 'Its schedules, meetings, enrollment links, and attendance records will also be permanently removed.',
    confirmText: 'Delete class',
  })
  if (!confirmed) return

  savingClass.value = true
  clearMessage()
  try {
    const { error } = await supabase.from('classes').delete().eq('id', item.id)
    if (error) throw error
    if (editingClassId.value === item.id) cancelClassEdit()
    classes.value = classes.value.filter((entry) => entry.id !== item.id)
    selectedClassId.value = visibleClasses.value[0]?.id ?? ''
    showSuccess('Class deleted.')
  } catch (error) {
    showError(error)
  } finally {
    savingClass.value = false
  }
}

async function loadClassDetails(classId: string, options: { generate?: boolean; silent?: boolean } = {}) {
  const request = ++classDetailsRequest
  const isCurrent = () => request === classDetailsRequest && classId === selectedClassId.value
  if (!options.silent) loadingDetails.value = true
  try {
    if (options.generate !== false && isCurrentSchoolWeek.value && !activeClass.value?.archived_at) {
      const { error: ensureError } = await supabase.rpc('ensure_current_week_meetings', { p_class_id: classId })
      if (!isCurrent()) return
      if (ensureError) throw ensureError
    }

    const [scheduleResult, meetingResult, enrollmentResult] = await Promise.all([
      supabase
        .from('class_schedules')
        .select('*')
        .eq('class_id', classId),
      supabase
        .from('meetings')
        .select(MEETING_COLUMNS)
        .eq('class_id', classId)
        .gte('starts_at', week.startIso)
        .lt('starts_at', week.endIso)
        .order('starts_at'),
      supabase.from('class_enrollments').select('student_id').eq('class_id', classId).eq('is_active', true),
    ])
    if (scheduleResult.error) throw scheduleResult.error
    if (meetingResult.error) throw meetingResult.error
    if (enrollmentResult.error) throw enrollmentResult.error
    const enrolledStudents = await loadStudents((enrollmentResult.data ?? []).map((row) => row.student_id))
    if (!isCurrent()) return

    schedules.value = ((scheduleResult.data ?? []) as ScheduleRow[])
      .map(schedule => ({ ...schedule, attendance_mode: schedule.attendance_mode ?? 'teacher_manual', check_in_minutes_after_start: schedule.check_in_minutes_after_start ?? null }))
      .sort((a, b) => scheduleSortValue(a) - scheduleSortValue(b) || a.starts_at.localeCompare(b.starts_at))
    meetings.value = (meetingResult.data ?? []) as MeetingRow[]
    students.value = enrolledStudents

    const previousMeetingId = selectedMeetingId.value
    const selectionStillExists = meetings.value.some((item) => item.id === previousMeetingId)
    selectedMeetingId.value = selectionStillExists ? previousMeetingId : meetings.value[0]?.id ?? ''
    if (selectedMeetingId.value && selectedMeetingId.value === previousMeetingId) {
      await loadAttendance(selectedMeetingId.value, options.silent)
    } else if (!selectedMeetingId.value) {
      attendanceRecords.value = []
    }
    await loadCalendar()
  } catch (error) {
    if (!isCurrent()) return
    if (!options.silent) clearClassDetails()
    showError(error)
  } finally {
    if (isCurrent()) loadingDetails.value = false
  }
}

function clearClassDetails() {
  ++attendanceRequest
  loadingAttendance.value = false
  schedules.value = []
  meetings.value = []
  students.value = []
  attendanceRecords.value = []
  selectedMeetingId.value = ''
}

async function loadStudents(studentIds: string[]): Promise<StudentRow[]> {
  if (!studentIds.length) return []
  const profileResult = await supabase.from('profiles').select('id,first_name,last_name,full_name,email').in('id', studentIds)
  if (profileResult.error) throw profileResult.error
  return (profileResult.data ?? [])
    .map((studentProfile) => ({
      id: studentProfile.id,
      first_name: studentProfile.first_name,
      last_name: studentProfile.last_name,
      full_name: studentProfile.full_name,
      email: studentProfile.email,
    }))
    .sort((a, b) => (a.last_name || a.full_name).localeCompare(b.last_name || b.full_name) || (a.first_name || '').localeCompare(b.first_name || '') || a.id.localeCompare(b.id))
}

async function saveSchedule() {
  if (!selectedClassId.value) return
  savingSchedule.value = true
  let saved = false
  clearMessage()
  try {
    if (!scheduleForm.starts_at || !scheduleForm.ends_at) throw new Error('Enter the schedule start and end times.')
    if (scheduleForm.ends_at <= scheduleForm.starts_at) throw new Error('Schedule end must be after its start.')
    const closesAtClassEnd = String(scheduleForm.check_in_minutes_after_start).trim() === ''
    const checkInClosingMinutes = closesAtClassEnd ? null : Number(scheduleForm.check_in_minutes_after_start)
    if (checkInClosingMinutes != null && (!Number.isInteger(checkInClosingMinutes) || checkInClosingMinutes < 1 || checkInClosingMinutes > 1440)) throw new Error('Check-in must close between 1 and 1440 whole minutes after class starts, or leave it empty to close at class end.')
    const payload = {
      class_id: selectedClassId.value,
      day_of_week: scheduleForm.day_of_week,
      starts_at: scheduleForm.starts_at,
      ends_at: scheduleForm.ends_at,
      room: scheduleForm.room.trim() || null,
      is_active: true,
      attendance_mode: scheduleForm.attendance_mode,
      check_in_minutes_after_start: checkInClosingMinutes,
    }

    const wasEditing = Boolean(editingScheduleId.value)
    let saveError: { code?: string; message?: string } | null
    if (wasEditing) {
      const { error } = await supabase.from('class_schedules').update(payload).eq('id', editingScheduleId.value)
      saveError = error
    } else {
      const { error } = await supabase.from('class_schedules').insert(payload)
      saveError = error
    }
    if (saveError?.code === 'PGRST204' || saveError?.code === '42703') throw new Error('The weekly schedule upgrade is not active on the server yet. Ask the administrator to apply the latest database update, then try again.')
    if (saveError) throw saveError

    await loadClassDetails(selectedClassId.value)
    saved = true
    showSuccess(
      wasEditing
        ? 'Weekly schedule updated. Existing meeting changes are preserved.'
        : 'Weekly schedule added. Meetings are generated automatically during their school week.',
    )
  } catch (error) {
    showError(error)
  } finally {
    savingSchedule.value = false
    if (saved) cancelScheduleEdit()
  }
}

function beginScheduleCreate() {
  editingScheduleId.value = ''
  resetScheduleForm()
  clearMessage()
  scheduleModalOpen.value = true
}

function beginScheduleEdit(schedule: ScheduleRow) {
  editingScheduleId.value = schedule.id
  scheduleForm.day_of_week = schedule.day_of_week
  scheduleForm.starts_at = schedule.starts_at.slice(0, 5)
  scheduleForm.ends_at = schedule.ends_at.slice(0, 5)
  scheduleForm.room = schedule.room ?? ''
  scheduleForm.attendance_mode = schedule.attendance_mode
  scheduleForm.check_in_minutes_after_start = schedule.check_in_minutes_after_start ?? ''
  scheduleForm.is_active = schedule.is_active
  clearMessage()
  scheduleModalOpen.value = true
}

function cancelScheduleEdit() {
  scheduleModalOpen.value = false
  editingScheduleId.value = ''
  resetScheduleForm()
}

function resetScheduleForm() {
  scheduleForm.day_of_week = 1
  scheduleForm.starts_at = '08:00'
  scheduleForm.ends_at = '09:00'
  scheduleForm.room = ''
  scheduleForm.attendance_mode = 'teacher_manual'
  scheduleForm.check_in_minutes_after_start = ''
  scheduleForm.is_active = true
}

async function deleteSchedule(schedule: ScheduleRow) {
  const confirmed = await confirmAction({
    header: `Delete ${dayLabel(schedule.day_of_week)} schedule?`,
    message: 'This stops future weekly meetings. Meetings already created remain available and can be disabled or deleted separately.',
    confirmText: 'Delete schedule',
  })
  if (!confirmed) return

  savingSchedule.value = true
  clearMessage()
  try {
    const { error } = await supabase.from('class_schedules').delete().eq('id', schedule.id)
    if (error) throw error
    if (editingScheduleId.value === schedule.id) cancelScheduleEdit()
    schedules.value = schedules.value.filter((item) => item.id !== schedule.id)
    meetings.value.forEach((meeting) => {
      if (meeting.schedule_id === schedule.id) meeting.schedule_id = null
    })
    await loadCalendar()
    showSuccess('Weekly schedule deleted.')
  } catch (error) {
    showError(error)
  } finally {
    savingSchedule.value = false
  }
}

async function saveMeeting() {
  if (!selectedClassId.value) return
  savingMeeting.value = true
  let saved = false
  clearMessage()
  try {
    validateMeetingWindow()
    const isOnline = meetingForm.mode === 'self_online'
    const payload = {
      class_id: selectedClassId.value,
      meeting_date: meetingForm.starts_at.slice(0, 10),
      starts_at: manilaInputToIso(meetingForm.starts_at),
      ends_at: manilaInputToIso(meetingForm.ends_at),
      attendance_mode: meetingForm.mode,
      attendance_enabled: true,
      attendance_opens_at: manilaInputToIso(meetingForm.starts_at),
      attendance_closes_at: manilaInputToIso(meetingForm.check_in_closes_at),
      latitude: isOnline ? null : SCHOOL_LATITUDE,
      longitude: isOnline ? null : SCHOOL_LONGITUDE,
      radius_m: SCHOOL_RADIUS_M,
      max_accuracy_m: activeClass.value?.default_max_accuracy_m ?? 100,
    }

    if (editingMeetingId.value) {
      const current = meetings.value.find((item) => item.id === editingMeetingId.value)
      const { data, error } = await supabase
        .from('meetings')
        .update({ ...payload, attendance_enabled: current?.attendance_enabled ?? true })
        .eq('id', editingMeetingId.value)
        .select(MEETING_COLUMNS)
        .single()
      if (error) throw error
      const updated = data as MeetingRow
      if (updated.starts_at >= week.startIso && updated.starts_at < week.endIso) {
        const index = meetings.value.findIndex((item) => item.id === updated.id)
        if (index >= 0) meetings.value[index] = updated
        meetings.value.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      } else {
        meetings.value = meetings.value.filter((item) => item.id !== updated.id)
        selectedMeetingId.value = meetings.value[0]?.id ?? ''
      }
      saved = true
      await loadCalendar()
      showSuccess(
        updated.starts_at >= week.startIso && updated.starts_at < week.endIso
          ? 'Meeting updated.'
          : 'Meeting updated. It will appear in the list during its scheduled week.',
      )
      return
    }

    const creatorId = await currentUserId()
    const { data, error } = await supabase
      .from('meetings')
      .insert({ ...payload, created_by: creatorId })
      .select(MEETING_COLUMNS)
      .single()
    if (error) throw error

    const created = data as MeetingRow
    if (created.starts_at >= week.startIso && created.starts_at < week.endIso) {
      meetings.value.push(created)
      meetings.value.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      selectedMeetingId.value = created.id
      showSuccess('Meeting and attendance window created.')
    } else {
      showSuccess('Meeting created. It will appear in the list during its scheduled week.')
    }
    saved = true
    await loadCalendar()
  } catch (error) {
    showError(error)
  } finally {
    savingMeeting.value = false
    if (saved) cancelMeetingEdit()
  }
}

function beginMeetingCreate() {
  editingMeetingId.value = ''
  resetMeetingForm()
  clearMessage()
  meetingModalOpen.value = true
}

function beginMeetingEdit(meeting: MeetingRow) {
  editingMeetingId.value = meeting.id
  meetingForm.mode = meeting.attendance_mode
  meetingForm.starts_at = isoToManilaInput(meeting.starts_at)
  meetingForm.ends_at = isoToManilaInput(meeting.ends_at)
  meetingForm.check_in_closes_at = isoToManilaInput(meeting.attendance_closes_at)
  clearMessage()
  meetingModalOpen.value = true
}

function cancelMeetingEdit() {
  meetingModalOpen.value = false
  editingMeetingId.value = ''
  resetMeetingForm()
}

function resetMeetingForm() {
  meetingForm.mode = 'teacher_manual'
  meetingForm.starts_at = `${calendarDate.value}T08:00`
  meetingForm.ends_at = `${calendarDate.value}T09:00`
  meetingForm.check_in_closes_at = `${calendarDate.value}T09:00`
}

async function toggleAttendance(meeting: MeetingRow) {
  if (meeting.attendance_enabled) {
    const confirmed = await confirmAction({
      header: 'Do not count this meeting?',
      message: 'Attendance remains saved, but this meeting will no longer count until you turn it back on.',
      confirmText: 'Do not count',
    })
    if (!confirmed) return
  }

  updatingMeeting.value = true
  clearMessage()
  try {
    const attendanceEnabled = !meeting.attendance_enabled
    const { error } = await supabase.from('meetings').update({ attendance_enabled: attendanceEnabled }).eq('id', meeting.id)
    if (error) throw error
    meeting.attendance_enabled = attendanceEnabled
    await loadCalendar()
    showSuccess(attendanceEnabled ? 'Attendance will count for this meeting.' : 'Attendance will not count for this meeting.')
  } catch (error) {
    showError(error)
  } finally {
    updatingMeeting.value = false
  }
}

async function deleteMeeting(meeting: MeetingRow) {
  const confirmed = await confirmAction({
    header: 'Delete meeting?',
    message: 'Its attendance records will also be permanently removed.',
    confirmText: 'Delete meeting',
  })
  if (!confirmed) return

  updatingMeeting.value = true
  clearMessage()
  try {
    const { error } = await supabase.from('meetings').delete().eq('id', meeting.id)
    if (error) throw error
    if (editingMeetingId.value === meeting.id) cancelMeetingEdit()
    meetings.value = meetings.value.filter((item) => item.id !== meeting.id)
    selectedMeetingId.value = meetings.value[0]?.id ?? ''
    await loadCalendar()
    showSuccess('Meeting deleted.')
  } catch (error) {
    showError(error)
  } finally {
    updatingMeeting.value = false
  }
}

async function loadAttendance(meetingId: string, silent = false) {
  const request = ++attendanceRequest
  const isCurrent = () => request === attendanceRequest && meetingId === selectedMeetingId.value
  if (!silent) {
    attendanceRecords.value = []
    loadingAttendance.value = true
  }
  try {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('id,meeting_id,student_id,status,source,selfie_path,latitude,longitude,accuracy_m,distance_m,barcode_verified,verification_status,teacher_note,review_note,submitted_at,created_at')
      .eq('meeting_id', meetingId)
    if (error) throw error
    if (!isCurrent()) return
    const records = (data ?? []) as AttendanceRow[]
    if (isCurrent()) {
      attendanceRecords.value = records
      if (selectedEvidence.value) {
        const current = records.find(record => record.id === selectedEvidence.value?.id)
        if (current) {
          const { review_note: _note, ...updates } = current
          const onlineLocation = selectedMeeting.value?.attendance_mode === 'self_online' ? { latitude: null, longitude: null, distance_m: null } : {}
          Object.assign(selectedEvidence.value, updates, onlineLocation)
        }
        else closeEvidence()
      }
    }
  } catch (error) {
    if (!isCurrent()) return
    if (!silent) attendanceRecords.value = []
    showError(error)
  } finally {
    if (isCurrent()) loadingAttendance.value = false
  }
}

async function markAttendance(studentId: string, status: AttendanceStatus) {
  if (!selectedMeetingId.value || !canMarkAttendance.value || markingStudentId.value) return
  const meetingId = selectedMeetingId.value
  markingStudentId.value = studentId
  clearMessage()
  try {
    const { error } = await supabase.rpc('record_manual_attendance', {
      p_meeting_id: meetingId,
      p_student_id: studentId,
      p_status: status,
      p_note: null,
    })
    if (error) throw error
    if (selectedMeetingId.value === meetingId) await loadAttendance(meetingId)
  } catch (error) {
    showError(error)
  } finally {
    markingStudentId.value = ''
  }
}

async function reviewEvidence(record: AttendanceRow, decision: 'approved' | 'rejected') {
  reviewingRecordId.value = record.id
  clearMessage()
  try {
    const { error } = await supabase.rpc('review_self_attendance', {
      p_attendance_id: record.id,
      p_decision: decision,
      p_note: record.review_note?.trim() || null,
    })
    if (error) throw error
    if (selectedMeetingId.value === record.meeting_id) await loadAttendance(record.meeting_id)
    selectedEvidence.value = null
    showSuccess(decision === 'approved' ? 'Self-check attendance restored.' : 'Invalid self-check attendance voided.')
  } catch (error) {
    evidenceError.value = toUserFacingErrorMessage(error)
    showError(error)
  } finally {
    reviewingRecordId.value = ''
  }
}

function openEvidence(record: AttendanceRow) {
  evidenceError.value = ''
  const onlineLocation = selectedMeeting.value?.attendance_mode === 'self_online' ? { latitude: null, longitude: null, distance_m: null } : {}
  selectedEvidence.value = { ...record, ...onlineLocation, meeting_starts_at: selectedMeeting.value?.starts_at, class_name: activeClass.value?.name, attendance_enabled: selectedMeeting.value?.attendance_enabled, location_status: record.source === 'teacher' && record.status === 'present' ? 'teacher_confirmed_on_campus' : undefined }
}

function closeEvidence() {
  if (reviewingRecordId.value) return
  selectedEvidence.value = null
  evidenceError.value = ''
}

async function reviewSelectedEvidence(voided: boolean, note: string) {
  if (!selectedEvidence.value) return
  selectedEvidence.value.review_note = note
  await setEvidenceVoided(selectedEvidence.value, voided)
}

async function setEvidenceVoided(record: AttendanceRow, voided: boolean) {
  if (voided) {
    const confirmed = await confirmAction({
      header: 'Void this self-check?',
      message: 'The student will no longer count as present for this meeting. You can restore it later.',
      confirmText: 'Void attendance',
    })
    if (!confirmed) return
  }
  await reviewEvidence(record, voided ? 'rejected' : 'approved')
}

function validateMeetingWindow() {
  const starts = new Date(manilaInputToIso(meetingForm.starts_at)).getTime()
  const ends = new Date(manilaInputToIso(meetingForm.ends_at)).getTime()
  const closes = new Date(manilaInputToIso(meetingForm.check_in_closes_at)).getTime()
  if ([starts, ends, closes].some(Number.isNaN)) throw new Error('Complete all meeting date and time fields.')
  if (starts < new Date(week.startIso).getTime() || starts >= new Date(week.endIso).getTime()) {
    throw new Error('The meeting must start within the selected school week. Select another week in the calendar to create it there.')
  }
  if (ends <= starts) throw new Error('Meeting end must be after its start.')
  if (closes <= starts) throw new Error('Check-in must close after class starts.')
}

function currentManilaWeek(anchor = new Date()) {
  const parts = datePartsInManila(anchor)
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const daysSinceMonday = (today.getUTCDay() + 6) % 7
  const monday = new Date(today)
  monday.setUTCDate(today.getUTCDate() - daysSinceMonday)
  const nextMonday = new Date(monday)
  nextMonday.setUTCDate(monday.getUTCDate() + 7)
  const sunday = new Date(nextMonday)
  sunday.setUTCDate(nextMonday.getUTCDate() - 1)
  const startDate = dateKey(monday)
  const endDate = dateKey(nextMonday)
  return {
    startDate,
    endDateInclusive: dateKey(sunday),
    startIso: new Date(`${startDate}T00:00:00+08:00`).toISOString(),
    endIso: new Date(`${endDate}T00:00:00+08:00`).toISOString(),
  }
}

function datePartsInManila(date: Date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: MANILA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  return { year: values.year, month: values.month, day: values.day }
}

function dateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function scheduleDateLabel(dayOfWeek: number) {
  const offsetFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const date = new Date(`${week.startDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offsetFromMonday)
  return displayDate(dateKey(date))
}

function scheduleCheckInWindow(schedule: { starts_at: string; ends_at: string; check_in_minutes_after_start: number | string | null }) {
  const [hour, minute] = schedule.starts_at.split(':').map(Number)
  const startMinutes = hour * 60 + minute
  if (!Number.isFinite(startMinutes)) return 'opens when class starts and closes at class end'
  const closingOffset = schedule.check_in_minutes_after_start
  const closesAtClassEnd = closingOffset == null || String(closingOffset).trim() === ''
  const formatMinutes = (minutes: number) => {
    const dayOffset = Math.floor(minutes / 1440)
    const normalized = ((minutes % 1440) + 1440) % 1440
    const clock = `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
    return `${formatTime(clock)}${dayOffset < 0 ? ' (previous day)' : dayOffset > 0 ? ' (next day)' : ''}`
  }
  const opening = formatMinutes(startMinutes)
  const closing = closesAtClassEnd ? formatTime(schedule.ends_at) : formatMinutes(startMinutes + Number(closingOffset))
  return `${opening} – ${closing}`
}

function displayDate(dateValue: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${dateValue}T00:00:00Z`))
}

function manilaInputToIso(value: string) {
  if (!value) return ''
  return new Date(`${value.length === 16 ? `${value}:00` : value}+08:00`).toISOString()
}

function isoToManilaInput(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(value))
    .filter((part) => part.type !== 'literal')
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

function scheduleSortValue(schedule: ScheduleRow) {
  return schedule.day_of_week === 0 ? 7 : schedule.day_of_week
}

function dayLabel(value: number) {
  return weekdays.find((day) => day.value === value)?.label ?? String(value)
}

function modeLabel(mode: MeetingMode) {
  return {
    teacher_manual: 'Teacher marks',
    self_on_site: 'On-site self-check',
    self_online: 'Online self-check',
  }[mode]
}

function studentName(studentId: string) {
  return students.value.find((student) => student.id === studentId)?.full_name ?? 'Student'
}
function studentListName(student: StudentRow) {
  return student.last_name ? `${student.last_name}, ${student.first_name || ''}`.replace(/,\s*$/, '') : student.full_name
}

function statusColor(status: AttendanceStatus) {
  return status === 'present' ? 'success' : 'danger'
}

function verificationColor(status: VerificationStatus | null) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return status === 'pending' ? 'warning' : 'medium'
}

function verificationLabel(status: VerificationStatus | null) {
  if (status === 'rejected') return 'Voided by teacher'
  if (status === 'approved') return 'Accepted automatically'
  if (status === 'pending') return 'Legacy review pending'
  return 'Not applicable'
}

function formatDateTime(value: string | null) {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat(undefined, {
    timeZone: MANILA_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatTime(value: string) {
  const [hours = '0', minutes = '00'] = value.split(':')
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes)))
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function mapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}

async function confirmAction(options: { header: string; message: string; confirmText: string }) {
  const alert = await alertController.create({
    header: options.header,
    message: options.message,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: options.confirmText, role: 'confirm' },
    ],
  })
  await alert.present()
  const result = await alert.onDidDismiss()
  return result.role === 'confirm'
}

function showError(error: unknown) {
  messageKind.value = 'error'
  message.value = toUserFacingErrorMessage(error)
}

function showSuccess(text: string) {
  messageKind.value = 'success'
  message.value = text
}

function clearMessage() {
  clearTimeout(feedbackTimeout)
  message.value = ''
}

async function logout() {
  signingOut.value = true
  try {
    await signOut()
    await router.replace('/login')
  } finally {
    signingOut.value = false
  }
}
</script>

<style scoped>
.upcoming-workspace { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); gap:20px; }
.upcoming-class { padding:clamp(20px,3vw,32px); }.upcoming-class h2 { margin:0 0 16px; font:30px/1.2 var(--campus-heading-font); color:var(--campus-text); overflow-wrap:anywhere; }.upcoming-class p:not(.eyebrow) { font-size:14px; line-height:1.7; color:var(--campus-muted); }.upcoming-time { color:var(--campus-text)!important; font-weight:600; }.current-class { border-left:4px solid var(--campus-success); }.upcoming-state { display:inline-block; margin-top:12px; padding:7px 10px; border-radius:20px; color:var(--campus-accent); background:var(--campus-accent-soft); font-size:11px; }.class-report-action { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; border-top:1px solid var(--campus-border); padding-top:20px; margin-top:20px; }.class-report-action strong { color:var(--campus-text); font-size:14px; }.class-report-action p { color:var(--campus-muted); font-size:12px; line-height:1.6; margin:6px 0 0; }
.guardian-link-button { padding:3px 0; border:0; background:transparent; color:var(--campus-accent); text-align:left; font:inherit; font-size:12px; text-decoration:underline; cursor:pointer; }.attendance-thumbnail { flex:0 0 auto; width:54px; height:54px; padding:0; border:1px solid var(--campus-border); border-radius:9px; background:var(--campus-surface-soft); cursor:pointer; }.evidence-actions { align-items:center; }
.centered {
  display: grid;
  min-height: 40vh;
  place-items: center;
}

.approval-card {
  max-width: 640px;
  margin: 2rem auto;
}

.form-grid {
  display: grid;
  gap: 12px;
}

.spaced-form,
.summary {
  margin-top: 16px;
}

.native-field {
  display: grid;
  gap: 6px;
  color: var(--ion-color-medium-shade);
  font-size: 0.8rem;
}

.native-field input {
  min-height: 48px;
  padding: 10px 12px;
  border: 1px solid var(--ion-color-medium-tint);
  border-radius: 4px;
  color: var(--ion-text-color);
  background: var(--ion-background-color);
  font: inherit;
}

.form-actions,
.row-actions,
.item-actions,
.meeting-actions,
.review-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.meeting-actions {
  margin-top: 14px;
}

.meeting-actions > div {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 6px;
}

.attendance-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.evidence-card {
  display: grid;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--ion-color-light-shade);
}

.evidence-main {
  display: flex;
  gap: 14px;
}

.evidence-copy h3,
.evidence-copy p {
  margin: 0 0 6px;
}

.selfie {
  width: 104px;
  height: 104px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--ion-color-light);
}

@media (max-width: 560px) {
  .item-actions,
  .attendance-buttons {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (min-width: 720px) {
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .full-row {
    grid-column: 1 / -1;
  }
}

/* Campus portal layout */
.teacher-page {
  --page-navy: var(--campus-navy, #063f2a);
  --page-blue: var(--campus-green, #087443);
  --page-blue-soft: var(--campus-accent-soft, #e6f0e9);
  --page-bg: var(--campus-bg, #f5f5ef);
  --page-surface: var(--campus-surface, #ffffff);
  --page-surface-soft: var(--campus-surface-soft, #f5f8fa);
  --page-text: var(--campus-text, #182632);
  --page-muted: var(--campus-muted, #62727f);
  --page-border: var(--campus-border, #d9e2e9);
  --page-success: var(--campus-success, #147a50);
  --page-success-soft: var(--campus-success-soft, #e1f4eb);
  --page-warning: var(--campus-warning, #91620d);
  --page-warning-soft: var(--campus-warning-soft, #fff3d5);
  --page-danger: var(--campus-danger, #bb3e45);
  --page-danger-soft: var(--campus-danger-soft, #fae9ea);
  --page-radius: var(--campus-radius, 18px);
  --page-shadow: var(--campus-shadow, 0 12px 36px rgba(6, 63, 42, 0.08));
  --ion-color-primary: var(--page-blue);
  color: var(--page-text);
}

.teacher-content { --background: var(--page-bg); }
.app-header { box-shadow: none; }
.app-toolbar {
  --background: var(--page-navy);
  --border-width: 0;
  --color: #f7fbfd;
  --min-height: 72px;
  --padding-start: clamp(12px, 3vw, 32px);
  --padding-end: clamp(8px, 2vw, 24px);
}

.brand-lockup,
.brand-lockup > span:last-child { display: flex; align-items: center; }
.brand-lockup { gap: 11px; }
.brand-lockup > span:last-child { align-items: flex-start; flex-direction: column; gap: 2px; }
.brand-lockup strong { font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; }
.brand-lockup small { color: rgba(247, 251, 253, 0.7); font-size: 0.68rem; font-weight: 500; }
.brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  font-weight: 800;
}
.sign-out-button { --border-radius: 10px; --color: #f7fbfd; font-weight: 600; }

.dashboard-shell { width: min(100%, 1400px); margin: 0 auto; padding: clamp(20px, 3vw, 38px); }
.dashboard-shell { max-width: 1180px; padding: 32px 28px 56px; }
.workspace-switcher { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 18px; margin-bottom: 22px; border: 1px solid var(--page-border); border-radius: var(--page-radius); background: var(--page-surface); }
.no-classes { display: grid; justify-items: start; gap: 12px; padding: 32px; }
.no-classes h2, .no-classes p { margin: 0; } .no-classes p { color: var(--page-muted); }
.overview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.overview-card { display: flex; flex-direction: column; align-items: start; padding: 24px; }
.overview-card h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: -.025em; }
.overview-card > p:not(.eyebrow) { margin: 0 0 18px; color: var(--page-muted); font-size: 13px; line-height: 1.6; }
.overview-card ion-button { margin-top: auto; }
.join-code-copy strong { margin-left: 8px; color: var(--page-blue); letter-spacing: .12em; }
.dashboard-heading,
.planning-heading,
.section-heading,
.active-class-summary,
.evidence-title-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.heading-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 9px; }
.dashboard-heading { align-items: flex-end; margin-bottom: 24px; }
.dashboard-heading h1,
.approval-card h1 {
  margin: 0;
  color: var(--page-text);
  font-size: clamp(1.6rem, 3vw, 2.15rem);
  font-weight: 700;
  letter-spacing: -0.035em;
}
.dashboard-heading > div > p:last-child,
.section-heading p,
.planning-heading > p,
.section-description,
.muted-copy,
.approval-copy { margin: 6px 0 0; color: var(--page-muted); line-height: 1.55; }
.eyebrow {
  margin: 0 0 5px;
  color: var(--page-blue);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.week-chip {
  display: grid;
  min-width: 230px;
  gap: 3px;
  padding: 12px 15px;
  border: 1px solid var(--page-border);
  border-radius: 14px;
  background: var(--page-surface);
}
.week-chip span { color: var(--page-muted); font-size: 0.7rem; font-weight: 650; text-transform: uppercase; }
.week-chip strong { color: var(--page-text); font-size: 0.86rem; }

.surface-card {
  margin: 0;
  border: 1px solid var(--page-border);
  border-radius: var(--page-radius);
  background: var(--page-surface);
  box-shadow: var(--page-shadow);
}
.class-workspace,
.attendance-card,
.meeting-control,
.week-overview,
.schedule-card,
.meeting-form-card,
.evidence-section { padding: clamp(18px, 2.4vw, 27px); }
.section-heading { align-items: flex-start; margin-bottom: 20px; }
.section-heading h2,
.planning-heading h2 { margin: 0; color: var(--page-text); font-size: 1.05rem; font-weight: 700; }
.class-heading { margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--page-border); }
.class-workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: clamp(22px, 4vw, 46px);
}
.class-workspace-grid.single-column { grid-template-columns: 1fr; }
.class-selection,
.class-form,
.form-heading,
.meeting-detail,
.evidence-copy { display: grid; }
.class-selection { align-content: start; gap: 15px; }
.class-form,
.schedule-form,
.meeting-form {
  align-content: start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--page-border);
  border-radius: 15px;
  background: var(--page-surface-soft);
}
.form-heading { gap: 3px; margin-bottom: 2px; }
.form-heading strong { color: var(--page-text); font-size: 0.94rem; }
.form-heading span { color: var(--page-muted); font-size: 0.78rem; line-height: 1.4; }
.active-class-summary {
  justify-content: flex-start;
  padding: 17px;
  border: 1px solid var(--page-border);
  border-radius: 15px;
  background: var(--page-surface-soft);
}
.class-avatar,
.student-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  background: var(--page-blue-soft);
  color: var(--page-blue);
  font-weight: 750;
}
.class-avatar { width: 48px; height: 48px; border-radius: 15px; font-size: 1.1rem; }
.class-identity { display: grid; min-width: 0; gap: 3px; }
.class-identity strong { overflow: hidden; color: var(--page-text); text-overflow: ellipsis; white-space: nowrap; }
.class-identity span,
.join-code-block span { color: var(--page-muted); font-size: 0.76rem; }
.join-code-block { display: grid; gap: 3px; margin-left: auto; padding-left: 16px; text-align: right; }
.join-code-block strong { color: var(--page-blue); font-size: 1.06rem; letter-spacing: 0.12em; }
.class-actions { justify-content: flex-start; }
.class-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.class-filters button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 42px; padding: 9px 16px; border: 1px solid var(--page-border); border-radius: 11px; background: var(--page-surface); color: var(--page-muted); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
.class-filters button.selected { border-color: var(--page-blue); background: var(--page-blue-soft); color: var(--page-blue); }
.class-filters button:focus-visible { outline: 3px solid var(--page-blue); outline-offset: 2px; }
.class-filters button span { display: grid; place-items: center; min-width: 22px; height: 22px; border-radius: 7px; background: var(--page-surface-soft); font-size: 12px; }
.archived-notice { margin: 0 0 18px; padding: 14px 16px; border: 1px solid var(--page-border); border-radius: 12px; background: var(--page-surface-soft); color: var(--page-muted); font-size: 13px; line-height: 1.6; }
.approval-live-note { margin: 20px 0 0; color: var(--page-muted); font-size: 13px; line-height: 1.6; }
.location-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 13px;
  border-radius: 12px;
  background: var(--page-blue-soft);
  color: var(--page-muted);
  font-size: 0.78rem;
  line-height: 1.5;
}
.location-pin { color: var(--page-blue); font-size: 1rem; font-weight: 800; }

.status-message {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 20px;
  padding: 13px 15px;
  border: 1px solid transparent;
  border-radius: 13px;
  font-size: 0.88rem;
  font-weight: 600;
}
.status-message.success { border-color: var(--page-success); background: var(--page-success-soft); color: var(--page-success); }
.status-message.error { border-color: var(--page-danger); background: var(--page-danger-soft); color: var(--page-danger); }
.status-message-icon {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border-radius: 50%;
  font-size: 0.75rem;
}
.status-message.success .status-message-icon { background: var(--page-success); color: var(--campus-on-accent); }
.status-message.error .status-message-icon { background: var(--page-danger); color: var(--ion-color-danger-contrast); }
.approval-message { margin: 18px 0; text-align: left; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 20px 0;
}
.stat-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 13px;
  padding: 17px;
  border: 1px solid var(--page-border);
  border-radius: 16px;
  background: var(--page-surface);
}
.stat-icon {
  display: grid;
  width: 39px;
  height: 39px;
  flex: 0 0 39px;
  place-items: center;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 800;
}
.stat-card > div { display: grid; gap: 2px; }
.stat-card > div > span { color: var(--page-muted); font-size: 0.76rem; font-weight: 650; }
.stat-card strong { color: var(--page-text); font-size: 1.55rem; line-height: 1; }
.present-stat .stat-icon { background: var(--page-success-soft); color: var(--page-success); }
.absent-stat .stat-icon { background: var(--page-danger-soft); color: var(--page-danger); }
.unchecked-stat .stat-icon { background: var(--page-surface-soft); color: var(--page-muted); }
.review-stat .stat-icon { background: var(--page-warning-soft); color: var(--page-warning); }

.attendance-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(280px, 0.75fr);
  gap: 18px;
  align-items: start;
}
.attendance-heading { align-items: center; }
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 0.73rem;
  font-weight: 700;
  white-space: nowrap;
}
.status-pill > span { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.status-pill.open { background: var(--page-success-soft); color: var(--page-success); }
.status-pill.closed { background: var(--page-surface-soft); color: var(--page-muted); }
.meeting-selector { margin-bottom: 12px; }
.student-list { border-top: 1px solid var(--page-border); }
.student-row {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid var(--page-border);
}
.student-row:last-child { border-bottom: 0; }
.student-avatar { width: 40px; height: 40px; border-radius: 13px; font-size: 0.82rem; }
.student-copy { display: grid; min-width: 0; justify-items: start; gap: 3px; }
.student-copy strong,
.student-copy > span { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; }
.student-copy strong { color: var(--page-text); font-size: 0.9rem; }
.student-copy > span { color: var(--page-muted); font-size: 0.76rem; }
.attendance-badge { margin-top: 2px; font-size: 0.64rem; text-transform: capitalize; }
.attendance-buttons,
.form-actions,
.row-actions,
.item-actions,
.review-buttons,
.badge-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.attendance-buttons { justify-content: flex-end; }
.self-check-lock { color: var(--page-muted); font-size: 11px; line-height: 1.6; }
.attendance-buttons ion-button { margin: 0; min-width: 90px; }
.row-actions ion-button, .item-actions ion-button { margin: 0; }
.attendance-side { display: grid; gap: 18px; }
.meeting-control .section-heading,
.week-overview .section-heading { margin-bottom: 16px; }
.badge-row { margin-bottom: 17px; }
.meeting-detail { gap: 6px; padding: 15px 0; border-top: 1px solid var(--page-border); }
.meeting-detail strong { color: var(--page-text); font-size: 0.92rem; }
.meeting-detail span { color: var(--page-muted); font-size: 0.77rem; line-height: 1.45; }
.full-button { width: 100%; margin: 6px 0 10px; }
.meeting-edit-actions { justify-content: space-between; }
.count-bubble {
  display: grid;
  min-width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 10px;
  background: var(--page-blue-soft);
  color: var(--page-blue);
  font-size: 0.8rem;
  font-weight: 750;
}
.mini-meeting-list { display: grid; }
.mini-meeting {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 12px 0;
  border: 0;
  border-top: 1px solid var(--page-border);
  background: transparent;
  color: var(--page-text);
  text-align: left;
  cursor: pointer;
}
.mini-meeting:first-child { border-top: 0; }
.mini-meeting.selected { margin: 0 -8px; padding-right: 8px; padding-left: 8px; border-radius: 11px; background: var(--page-blue-soft); }
.mini-date { color: var(--page-blue); font-size: 0.7rem; font-weight: 700; }
.mini-meeting > span:last-child { display: grid; min-width: 0; gap: 3px; }
.mini-meeting strong,
.mini-meeting small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini-meeting strong { font-size: 0.8rem; }
.mini-meeting small { color: var(--page-muted); font-size: 0.7rem; }

.planning-section { margin-top: 34px; }
.collective-calendar { display: grid; gap: 12px; margin: 0 0 24px; }
.planning-heading { align-items: flex-end; margin-bottom: 17px; }
.planning-heading > p { max-width: 520px; text-align: right; }
.planning-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
.section-description { margin: -10px 0 18px; font-size: 0.82rem; }
.meeting-callout { display: grid; gap: 16px; color: var(--page-muted); font-size: 0.82rem; line-height: 1.5; }
.meeting-callout ion-button { justify-self: start; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.full-row { grid-column: 1 / -1; }
.schedule-list { margin-top: 20px; border-top: 1px solid var(--page-border); }
.schedule-row {
  display: grid;
  grid-template-columns: 43px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 13px 0;
  border-bottom: 1px solid var(--page-border);
}
.schedule-row:last-child { border-bottom: 0; }
.schedule-day { display: grid; height: 38px; place-items: center; border-radius: 11px; background: var(--page-blue-soft); color: var(--page-blue); font-size: 0.72rem; font-weight: 750; }
.schedule-copy { display: grid; min-width: 0; justify-items: start; gap: 3px; }
.schedule-copy strong { color: var(--page-text); font-size: 0.8rem; }
.schedule-copy > span { color: var(--page-muted); font-size: 0.73rem; }
.native-field { display: grid; gap: 7px; color: var(--page-muted); font-size: 0.75rem; font-weight: 600; }
.native-field input {
  min-width: 0;
  min-height: 56px;
  padding: 10px 12px;
  border: 1px solid var(--page-border);
  border-radius: 10px;
  outline: none;
  background: var(--page-surface);
  color: var(--page-text);
  font: inherit;
  font-size: 0.86rem;
}
.native-field input:focus { border-color: var(--page-blue); box-shadow: 0 0 0 3px rgba(var(--ion-color-primary-rgb), 0.14); }

.evidence-section { margin-top: 18px; }
.review-count { background: var(--page-warning-soft); color: var(--page-warning); }
.evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.evidence-card {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 15px;
  border: 1px solid var(--page-border);
  border-radius: 15px;
  background: var(--page-surface-soft);
}
.evidence-main { display: flex; gap: 14px; }
.evidence-copy { min-width: 0; align-content: start; gap: 5px; }
.evidence-title-row { align-items: flex-start; gap: 8px; margin-bottom: 2px; }
.evidence-copy h3,
.evidence-copy p { margin: 0; }
.evidence-copy h3 { color: var(--page-text); font-size: 0.92rem; }
.evidence-copy p,
.evidence-copy a { color: var(--page-muted); font-size: 0.75rem; line-height: 1.45; }
.evidence-copy a { color: var(--page-blue); font-weight: 650; }
.selfie { width: 108px; height: 108px; flex: 0 0 108px; border-radius: 13px; background: var(--page-surface-soft); object-fit: cover; }
.selfie-placeholder { display: grid; place-items: center; color: var(--page-muted); font-size: 0.68rem; }

.empty-state,
.inline-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 105px;
  padding: 18px;
  border: 1px dashed var(--page-border);
  border-radius: 14px;
  color: var(--page-muted);
}
.empty-state > span:first-child { display: grid; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; border-radius: 12px; background: var(--page-surface-soft); color: var(--page-blue); font-weight: 750; }
.empty-state div { display: grid; gap: 3px; }
.empty-state strong { color: var(--page-text); font-size: 0.86rem; }
.empty-state p { margin: 0; font-size: 0.76rem; line-height: 1.45; }
.compact-empty { min-height: 82px; }
.inline-loading { justify-content: center; border: 0; }
.empty-note { display: block; padding: 13px 14px; border-radius: 12px; background: var(--page-blue-soft); color: var(--page-muted); }

.centered { min-height: 56vh; align-content: center; gap: 12px; color: var(--page-muted); font-size: 0.86rem; }
.approval-card { max-width: 620px; margin: clamp(30px, 9vh, 100px) auto; text-align: center; }
.approval-card ion-card-content { padding: clamp(26px, 5vw, 48px); }
.approval-icon { display: grid; width: 62px; height: 62px; margin: 0 auto 18px; place-items: center; border-radius: 20px; background: var(--page-warning-soft); color: var(--page-warning); font-size: 1.4rem; font-weight: 800; }
.approval-icon.rejected { background: var(--page-danger-soft); color: var(--page-danger); }
.approval-card ion-badge { margin-top: 14px; }
.approval-copy { max-width: 470px; margin: 18px auto; }
.admin-note { padding: 12px; border-radius: 11px; background: var(--page-bg); color: var(--page-muted); font-size: 0.82rem; }

ion-input,
ion-select,
ion-textarea { --background: var(--page-surface); --border-color: var(--page-border); --border-radius: 10px; --color: var(--page-text); --highlight-color-focused: var(--page-blue); --placeholder-color: var(--page-muted); }
ion-button { --border-radius: 10px; min-height: 38px; font-weight: 650; letter-spacing: 0; text-transform: none; }
ion-badge { --padding-start: 8px; --padding-end: 8px; border-radius: 999px; font-weight: 650; }

.management-modal {
  --page-blue: var(--campus-green, #087443);
  --page-blue-soft: var(--campus-accent-soft);
  --page-bg: var(--campus-bg);
  --page-surface: var(--campus-surface, #ffffff);
  --page-surface-soft: var(--campus-surface-soft);
  --page-text: var(--campus-text);
  --page-muted: var(--campus-muted);
  --page-border: var(--campus-border);
  --page-danger: var(--campus-danger, #bb3e45);
  --page-danger-soft: var(--campus-danger-soft, #fae9ea);
  --width: min(700px, calc(100% - 32px));
  --height: min(680px, calc(100% - 32px));
  --border-radius: 20px;
  --ion-color-primary: var(--page-blue);
  color: var(--page-text);
}
.management-modal.compact-management-modal { --height: min(500px, calc(100% - 32px)); }
.management-modal.meeting-editor-modal { --height: min(780px, calc(100% - 32px)); }
.modal-content { --background: var(--page-bg); }
.modal-form { display: grid; gap: 14px; padding: 0; }
.modal-form .status-message { margin-bottom: 0; }
.notification-note {
  display: grid;
  gap: 4px;
  padding: 13px 14px;
  border-radius: 12px;
  background: var(--page-blue-soft);
  color: var(--page-muted);
  font-size: 0.76rem;
  line-height: 1.45;
}
.notification-note strong { color: var(--page-text); font-size: 0.8rem; }
.schedule-help { margin: 0; color: var(--campus-muted); font-size: 12px; line-height: 1.6; }

@media (max-width: 1100px) {
  .attendance-layout { grid-template-columns: 1fr; }
  .attendance-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .evidence-grid { grid-template-columns: 1fr; }
}

@media (max-width: 860px) {
  .overview-grid { grid-template-columns: 1fr; }
  .class-workspace-grid,
  .planning-grid { grid-template-columns: 1fr; }
  .planning-heading { align-items: flex-start; flex-direction: column; }
  .planning-heading > p { max-width: none; text-align: left; }
}

@media (max-width: 680px) {
  .workspace-switcher { grid-template-columns: 1fr; padding: 14px; }
  .management-modal,
  .management-modal.compact-management-modal,
  .management-modal.meeting-editor-modal { --width: 100%; --height: 100%; --border-radius: 0; }
  .modal-form { padding: 0; }
  .app-toolbar { --min-height: 64px; }
  .dashboard-shell { padding: 18px 13px 34px; }
  .dashboard-heading { align-items: flex-start; flex-direction: column; }
  .week-chip { width: 100%; }
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
  .stat-card { gap: 9px; padding: 13px; }
  .stat-icon { width: 34px; height: 34px; flex-basis: 34px; }
  .stat-card strong { font-size: 1.3rem; }
  .attendance-side { grid-template-columns: 1fr; }
  .class-workspace,
  .attendance-card,
  .meeting-control,
  .week-overview,
  .schedule-card,
  .meeting-form-card,
  .evidence-section { padding: 17px; }
  .student-row { grid-template-columns: auto minmax(0, 1fr); }
  .attendance-buttons { display: grid; grid-column: 2; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; justify-content: stretch; gap: 8px; }
  .attendance-buttons.evidence-actions { grid-template-columns: 1fr; }
  .attendance-buttons ion-button { width: 100%; min-width: 0; min-height: 42px; font-size: 12px; }
  .class-actions, .meeting-edit-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .class-actions ion-button:last-child { grid-column: 1 / -1; }
  .class-actions ion-button, .meeting-edit-actions ion-button { width: 100%; min-width: 0; }
  .form-grid { grid-template-columns: 1fr; }
  .full-row { grid-column: auto; }
  .schedule-row { grid-template-columns: 40px minmax(0, 1fr); }
  .schedule-row .item-actions { display: grid; grid-column: 2; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; gap: 8px; }
  .schedule-row .item-actions ion-button { width: 100%; min-height: 40px; }
}

@media (max-width: 450px) {
  .brand-lockup small { display: none; }
  .brand-lockup strong { font-size: 0.9rem; }
  .brand-mark { width: 34px; height: 34px; flex-basis: 34px; }
  .sign-out-button { font-size: 0.78rem; }
  .active-class-summary { display: grid; grid-template-columns: auto 1fr; }
  .join-code-block { grid-column: 1 / -1; margin-left: 0; padding: 11px 0 0; border-top: 1px solid var(--page-border); text-align: left; }
  .attendance-heading { align-items: flex-start; flex-direction: column; }
  .evidence-main { display: grid; }
  .selfie { width: 100%; height: 210px; }
}
</style>
